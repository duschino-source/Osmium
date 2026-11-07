import React, { useState } from 'react';
import { Icon } from './Icon.js';

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  codeSnippet?: string;
  timestamp: string;
}

export interface AgentDockedPanelProps {
  activeFileName?: string;
  onSendMessage?: (msg: string) => Promise<string | void>;
  onApplyCode?: (code: string) => void;
  onClose?: () => void;
}

export const AgentDockedPanel: React.FC<AgentDockedPanelProps> = ({
  activeFileName = 'App.tsx',
  onSendMessage,
  onApplyCode,
  onClose,
}) => {
  const [messages, setMessages] = useState<AgentChatMessage[]>([
    {
      id: 'msg-init',
      role: 'assistant',
      content: `I'm your docked coding assistant. I can explain code, suggest optimizations, generate tests, or refactor ${activeFileName}.`,
      timestamp: 'Now',
    },
  ]);
  const [inputVal, setInputVal] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const handleSend = async (textToSend?: string) => {
    const text = textToSend || inputVal.trim();
    if (!text) return;

    const userMsg: AgentChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: 'Just now',
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputVal('');
    setIsBusy(true);

    try {
      if (onSendMessage) {
        const resp = await onSendMessage(text);
        if (resp) {
          setMessages((prev) => [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: resp,
              timestamp: 'Just now',
            },
          ]);
        }
      } else {
        // Default smart simulated response for docked assistant
        setTimeout(() => {
          setMessages((prev) => [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: `Analyzed \`${activeFileName}\`. Everything looks clean and well-structured according to Osmium architectural specs.`,
              timestamp: 'Just now',
            },
          ]);
          setIsBusy(false);
        }, 500);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${err.message || String(err)}`,
          timestamp: 'Just now',
        },
      ]);
    } finally {
      if (onSendMessage) setIsBusy(false);
    }
  };

  return (
    <div data-testid="ide-agent-docked-panel" className="wb-agent">
      {/* Header */}
      <div className="wb-agent-head">
        <div className="wb-agent-title">
          <span className="wb-agent-dot" />
          <span>Agent Assistant</span>
        </div>
        {onClose && (
          <button
            type="button"
            aria-label="Close Agent Panel"
            onClick={onClose}
            className="wb-icon-btn"
          >
            <Icon name="x" size={14} />
          </button>
        )}
      </div>

      {/* Context Chips */}
      <div className="wb-agent-chips">
        <span className="os-chip">@file {activeFileName}</span>
        <span className="os-chip">@problems (0)</span>
      </div>

      {/* Messages Stream */}
      <div className="wb-agent-messages">
        {messages.map((m) => (
          <div key={m.id} className="wb-msg" data-role={m.role}>
            <div className="wb-msg-bubble">{m.content}</div>
            {m.codeSnippet && (
              <div className="wb-msg-code">
                <div className="wb-msg-code-head">
                  <button
                    type="button"
                    className="wb-link-btn"
                    onClick={() => onApplyCode?.(m.codeSnippet!)}
                  >
                    Insert Code
                  </button>
                </div>
                <pre>{m.codeSnippet}</pre>
              </div>
            )}
          </div>
        ))}
        {isBusy && <div className="wb-busy">Agent is thinking...</div>}
      </div>

      {/* Quick Prompts */}
      <div className="wb-agent-quick">
        <button
          type="button"
          className="wb-quick-btn"
          onClick={() => handleSend(`Explain ${activeFileName}`)}
        >
          Explain file
        </button>
        <button
          type="button"
          className="wb-quick-btn"
          onClick={() => handleSend('Review changes and check for issues')}
        >
          Review diff
        </button>
      </div>

      {/* Chat Input */}
      <form
        className="wb-agent-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <input
          type="text"
          data-testid="agent-input"
          placeholder="Ask agent about this code..."
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          className="wb-field"
        />
        <button
          type="submit"
          data-testid="agent-send-btn"
          disabled={!inputVal.trim()}
          className="os-btn os-btn-primary"
        >
          Send
        </button>
      </form>
    </div>
  );
};
