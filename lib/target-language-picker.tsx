import { ChevronDown, Languages, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { TargetLanguage } from './types';
import {
  customTargetLanguage,
  WRITING_TARGET_LANGUAGES,
} from './writing-languages';

interface TargetLanguagePickerProps {
  target: TargetLanguage;
  onTarget: (target: TargetLanguage) => void;
}

export function TargetLanguagePicker({ target, onTarget }: TargetLanguagePickerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [customError, setCustomError] = useState('');

  const languages = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return WRITING_TARGET_LANGUAGES;
    return WRITING_TARGET_LANGUAGES.filter(
      (language) =>
        language.name.toLocaleLowerCase().includes(needle) ||
        language.code.toLocaleLowerCase().includes(needle),
    );
  }, [query]);

  const chooseTarget = (nextTarget: TargetLanguage) => {
    setPickerOpen(false);
    setQuery('');
    onTarget(nextTarget);
  };

  const useCustomTarget = () => {
    const result = customTargetLanguage(customName, customCode);
    if (!result.language) {
      setCustomError(result.error ?? 'Invalid language.');
      return;
    }
    setCustomError('');
    setCustomOpen(false);
    chooseTarget(result.language);
  };

  return (
    <div className="target-wrap">
      <button
        className="target-button"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={pickerOpen}
        onClick={() => setPickerOpen((open) => !open)}
      >
        <Languages size={15} />
        <span>{target.name}</span>
        <ChevronDown size={14} />
      </button>
      {pickerOpen && (
        <div className="picker">
          <label className="search-row">
            <Search size={14} />
            <input
              type="search"
              value={query}
              placeholder="Search languages"
              aria-label="Search languages"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="language-list" role="listbox" aria-label="Target language">
            {languages.map((language) => (
              <button
                className={`language-option ${language.code === target.code ? 'selected' : ''}`}
                type="button"
                role="option"
                aria-selected={language.code === target.code}
                key={language.code}
                onClick={() => chooseTarget(language)}
              >
                <span>{language.name}</span>
                <small>{language.code}</small>
              </button>
            ))}
            {languages.length === 0 && (
              <div className="language-option" aria-live="polite">
                No matching languages
              </div>
            )}
          </div>
          <button
            className="language-option custom-toggle"
            type="button"
            onClick={() => setCustomOpen((open) => !open)}
          >
            Custom language
          </button>
          {customOpen && (
            <div className="custom-grid">
              <input
                value={customName}
                aria-label="Custom language name"
                placeholder="Language name"
                onChange={(event) => setCustomName(event.target.value)}
              />
              <input
                value={customCode}
                aria-label="Custom language code"
                placeholder="Code"
                onChange={(event) => setCustomCode(event.target.value)}
              />
              {customError && <p className="custom-error">{customError}</p>}
              <button className="command" type="button" onClick={useCustomTarget}>
                Use language
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
