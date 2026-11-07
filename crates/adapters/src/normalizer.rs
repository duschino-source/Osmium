//! Event normalizer for streaming CLI output.

use osmium_core::types::{AgentEvent, MessageRole, SessionState};

/// Strips ANSI escape sequences from terminal or PTY output.
pub fn strip_ansi_codes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\x1B' {
            loop {
                match chars.peek() {
                    Some(&'\x1B') => {
                        chars.next();
                        continue;
                    }
                    Some(&'[') => {
                        chars.next(); // consume '['
                                      // Consume CSI parameters and intermediate bytes up to final byte (0x40..=0x7E)
                                      // If another '\x1B' is encountered, it aborts the current CSI sequence and restarts escape parsing.
                        let mut restarted = false;
                        while let Some(&next) = chars.peek() {
                            chars.next();
                            if next == '\x1B' {
                                restarted = true;
                                break;
                            }
                            if (0x40..=0x7E).contains(&(next as u32)) {
                                break;
                            }
                        }
                        if restarted {
                            continue;
                        }
                        break;
                    }
                    Some(&']') => {
                        chars.next(); // consume ']'
                                      // OSC sequence: consume until BEL (\x07) or ST (\x1b\)
                        let mut restarted = false;
                        while let Some(next) = chars.next() {
                            if next == '\x07' {
                                break;
                            }
                            if next == '\x1B' {
                                if chars.peek() == Some(&'\\') {
                                    chars.next();
                                    break;
                                } else {
                                    restarted = true;
                                    break;
                                }
                            }
                        }
                        if restarted {
                            continue;
                        }
                        break;
                    }
                    Some(&('7' | '8' | '=' | '>' | 'M' | 'D' | 'E' | 'H')) => {
                        chars.next(); // standard 2-character / Fe escape code
                        break;
                    }
                    _ => break,
                }
            }
        } else {
            out.push(c);
        }
    }

    out
}

/// State machine parser normalizing arbitrary subprocess output into canonical AgentEvents.
pub struct NormalizedEventStreamParser {
    max_buffer_bytes: usize,
    buffer: String,
    events: Vec<AgentEvent>,
    state: SessionState,
}

pub type EventNormalizer = NormalizedEventStreamParser;

impl Default for NormalizedEventStreamParser {
    fn default() -> Self {
        Self::new(None)
    }
}

impl NormalizedEventStreamParser {
    pub const DEFAULT_MAX_BUFFER_BYTES: usize = 16 * 1024 * 1024; // 16 MB

    pub fn new(max_buffer_bytes: Option<usize>) -> Self {
        Self {
            max_buffer_bytes: max_buffer_bytes.unwrap_or(Self::DEFAULT_MAX_BUFFER_BYTES),
            buffer: String::new(),
            events: Vec::new(),
            state: SessionState::Idle,
        }
    }

    pub fn current_state(&self) -> SessionState {
        self.state
    }

    pub fn collected_events(&self) -> &[AgentEvent] {
        &self.events
    }

    /// Process a single complete line directly
    pub fn process_line(&mut self, line: &str) -> Vec<AgentEvent> {
        let trimmed = line.trim_end_matches('\r').trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        let clean_line = strip_ansi_codes(trimmed);
        let clean_trimmed = clean_line.trim();

        let mut parsed: Option<AgentEvent> = None;
        if clean_trimmed.starts_with('{') && clean_trimmed.ends_with('}') {
            if let Ok(event) = serde_json::from_str::<AgentEvent>(clean_trimmed) {
                parsed = Some(event);
            }
        }

        let event = match parsed {
            Some(event) => {
                if let AgentEvent::Status { state, .. } = &event {
                    self.state = *state;
                }
                event
            }
            None => AgentEvent::Raw {
                data: line.trim_end_matches('\r').to_string(),
            },
        };

        self.events.push(event.clone());
        vec![event]
    }

    /// Appends a chunk of stream data and returns newly emitted normalized events.
    pub fn write_chunk(&mut self, chunk: &str) -> Vec<AgentEvent> {
        if self.buffer.len() + chunk.len() > self.max_buffer_bytes {
            let mut overflow = std::mem::take(&mut self.buffer);
            overflow.push_str(chunk);
            let mut cutoff = (0..=self.max_buffer_bytes)
                .rev()
                .find(|&i| overflow.is_char_boundary(i))
                .unwrap_or(0);
            if cutoff == 0 && !overflow.is_empty() {
                cutoff = overflow.chars().next().map(|c| c.len_utf8()).unwrap_or(1);
            }
            let truncated = &overflow[..cutoff];
            let event = AgentEvent::Raw {
                data: truncated.to_string(),
            };
            self.events.push(event.clone());
            self.buffer = overflow[cutoff..].to_string();
            return vec![event];
        }

        self.buffer.push_str(chunk);

        // Extract complete lines terminated by \n
        let Some(last_newline_idx) = self.buffer.rfind('\n') else {
            return Vec::new();
        };

        let complete_lines = self.buffer[..=last_newline_idx].to_string();
        self.buffer.drain(..=last_newline_idx);

        let mut emitted = Vec::new();
        for raw_line in complete_lines.split('\n') {
            let line_events = self.process_line(raw_line);
            emitted.extend(line_events);
        }

        emitted
    }

    /// Handles unexpected EOF or child process exit.
    pub fn handle_unexpected_eof(&mut self, exit_code: Option<i32>) -> Vec<AgentEvent> {
        let mut emitted = Vec::new();

        if !self.buffer.is_empty() {
            let leftover = std::mem::take(&mut self.buffer);
            let clean = strip_ansi_codes(&leftover);
            let event = AgentEvent::Raw {
                data: clean.trim_end_matches('\r').to_string(),
            };
            self.events.push(event.clone());
            emitted.push(event);
        }

        if self.state == SessionState::Working || exit_code.map(|c| c != 0).unwrap_or(true) {
            self.state = SessionState::Error;
            let err_event = AgentEvent::Status {
                state: SessionState::Error,
                message: Some(format!(
                    "Stream terminated unexpectedly while working (exit code {:?})",
                    exit_code
                )),
            };
            self.events.push(err_event.clone());
            emitted.push(err_event);
        }

        emitted
    }
}

/// Assembles streaming assistant message chunks into final text.
pub fn assemble_streamed_message(events: &[AgentEvent]) -> Option<String> {
    let assistant_msgs: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::Message {
                role: MessageRole::Assistant,
                text,
                final_,
            } => Some((text.as_str(), *final_)),
            _ => None,
        })
        .collect();

    if assistant_msgs.is_empty() {
        return None;
    }

    if let Some((final_text, _)) = assistant_msgs.iter().find(|(_, is_final)| *is_final) {
        return Some(final_text.to_string());
    }

    let concatenated = assistant_msgs
        .iter()
        .map(|(t, _)| *t)
        .collect::<Vec<_>>()
        .join("");
    Some(concatenated)
}
