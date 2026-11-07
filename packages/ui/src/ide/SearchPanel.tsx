import React, { useState } from 'react';

export interface SearchMatchItem {
  filePath: string;
  relPath: string;
  line: number;
  column: number;
  lineText: string;
  matchText: string;
}

export interface SearchPanelProps {
  onSearch: (
    query: string,
    opts: { isRegex: boolean; caseSensitive: boolean; wholeWord: boolean },
  ) => Promise<SearchMatchItem[]>;
  onSelectMatch: (match: SearchMatchItem) => void;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({ onSearch, onSelectMatch }) => {
  const [query, setQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [results, setResults] = useState<SearchMatchItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setIsSearching(true);
    setSearched(true);
    try {
      const res = await onSearch(query, { isRegex, caseSensitive, wholeWord });
      setResults(res);
    } finally {
      setIsSearching(false);
    }
  };

  // Group matches by file
  const grouped = results.reduce<Record<string, SearchMatchItem[]>>((acc, item) => {
    acc[item.relPath] = acc[item.relPath] || [];
    acc[item.relPath].push(item);
    return acc;
  }, {});

  return (
    <div data-testid="ide-search-panel" className="wb-panel">
      <div className="wb-panel-head">
        <span className="wb-panel-title">SEARCH</span>
      </div>

      <form onSubmit={handleSearchSubmit} className="wb-panel-head">
        <input
          type="text"
          className="wb-field"
          data-testid="search-input"
          placeholder="Search across files..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="wb-panel-actions">
          <button
            type="button"
            className="wb-icon-btn"
            title="Match Case (Alt+C)"
            aria-pressed={caseSensitive}
            onClick={() => setCaseSensitive(!caseSensitive)}
          >
            Aa
          </button>
          <button
            type="button"
            className="wb-icon-btn"
            title="Match Whole Word (Alt+W)"
            aria-pressed={wholeWord}
            onClick={() => setWholeWord(!wholeWord)}
          >
            \b
          </button>
          <button
            type="button"
            className="wb-icon-btn"
            title="Use Regular Expression (Alt+R)"
            aria-pressed={isRegex}
            onClick={() => setIsRegex(!isRegex)}
          >
            .*
          </button>
        </div>
      </form>

      {/* Results List */}
      <div className="wb-body">
        {isSearching && <div className="wb-empty">Searching...</div>}

        {!isSearching && searched && results.length === 0 && (
          <div className="wb-empty">No results found.</div>
        )}

        {Object.entries(grouped).map(([relPath, matches]) => (
          <div key={relPath}>
            <div className="wb-section-title">
              <span className="wb-row-label">{relPath}</span>
              <span> ({matches.length})</span>
            </div>
            <div>
              {matches.map((m, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="wb-row"
                  data-testid="search-result-item"
                  onClick={() => onSelectMatch(m)}
                >
                  <span>{m.line}</span>
                  <span className="wb-row-label">{m.lineText}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
