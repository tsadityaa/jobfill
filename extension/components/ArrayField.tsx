import { useState, useEffect, useRef } from 'react';
import { generateId } from '../types/profile';
import CopyButton from './CopyButton';

// ---- Generic types for array items ----

interface ArrayItem {
  id: string;
  primary?: boolean;
  label?: string;
}

interface ArrayFieldProps<T extends ArrayItem> {
  items: T[];
  onChange: (items: T[]) => void;
  renderItem: (item: T) => React.ReactNode;
  renderForm: (
    item: Partial<T>,
    onChange: (item: Partial<T>) => void,
  ) => React.ReactNode;
  createDefault: () => Omit<T, 'id'>;
  addLabel: string;
  emptyLabel: string;
  showPrimary?: boolean;
  /** Optional function to extract copy value from an item */
  copyValue?: (item: T) => string;
}

export default function ArrayField<T extends ArrayItem>({
  items,
  onChange,
  renderItem,
  renderForm,
  createDefault,
  addLabel,
  emptyLabel,
  showPrimary = false,
  copyValue,
}: ArrayFieldProps<T>) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<T>>({});
  const [isAdding, setIsAdding] = useState(false);
  // Stable id assigned when "Add" mode opens — so auto-save can upsert the same item
  const pendingIdRef = useRef<string | null>(null);

  // Auto-save draft on every change (debounced 600ms)
  useEffect(() => {
    if (!isAdding && !editingId) return;
    const timer = setTimeout(() => {
      if (isAdding) {
        // Assign a stable id on first auto-save
        if (!pendingIdRef.current) {
          pendingIdRef.current = generateId();
        }
        const newItem = {
          ...draft,
          id: pendingIdRef.current,
          primary: items.length === 0 ? true : (draft.primary ?? false),
        } as T;
        // Upsert: replace if already auto-saved, otherwise append
        const exists = items.some((i) => i.id === pendingIdRef.current);
        let updated: T[];
        if (exists) {
          updated = items.map((i) => (i.id === pendingIdRef.current ? newItem : i));
        } else {
          updated = newItem.primary
            ? [...items.map((i) => ({ ...i, primary: false })), newItem]
            : [...items, newItem];
        }
        onChange(updated);
      } else if (editingId) {
        let updated = items.map((i) =>
          i.id === editingId ? { ...i, ...draft } : i,
        );
        if (draft.primary) {
          updated = updated.map((i) => ({ ...i, primary: i.id === editingId }));
        }
        onChange(updated);
      }
    }, 600);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const handleAdd = () => {
    pendingIdRef.current = null;
    setDraft(createDefault() as Partial<T>);
    setIsAdding(true);
    setEditingId(null);
  };

  const handleEdit = (item: T) => {
    setDraft({ ...item });
    setEditingId(item.id);
    setIsAdding(false);
  };

  const handleSave = () => {
    if (isAdding) {
      // Use the pending id if auto-save already created it, otherwise generate fresh
      const id = pendingIdRef.current ?? generateId();
      const newItem = {
        ...draft,
        id,
        primary: items.length === 0 ? true : (draft.primary ?? false),
      } as T;
      const exists = items.some((i) => i.id === id);
      let updated: T[];
      if (exists) {
        updated = items.map((i) => (i.id === id ? newItem : i));
      } else if (newItem.primary) {
        updated = [...items.map((i) => ({ ...i, primary: false })), newItem];
      } else {
        updated = [...items, newItem];
      }
      onChange(updated);
    } else if (editingId) {
      let updated = items.map((i) =>
        i.id === editingId ? { ...i, ...draft } : i,
      );
      if (draft.primary) {
        updated = updated.map((i) => ({ ...i, primary: i.id === editingId }));
      }
      onChange(updated);
    }
    pendingIdRef.current = null;
    setIsAdding(false);
    setEditingId(null);
    setDraft({});
  };

  const handleCancel = () => {
    // Remove the auto-saved draft item if it was added
    if (isAdding && pendingIdRef.current) {
      onChange(items.filter((i) => i.id !== pendingIdRef.current));
    }
    pendingIdRef.current = null;
    setIsAdding(false);
    setEditingId(null);
    setDraft({});
  };

  const handleDelete = (id: string) => {
    const remaining = items.filter((i) => i.id !== id);
    // If we deleted the primary, make the first remaining item primary
    if (remaining.length > 0 && !remaining.some((i) => i.primary)) {
      remaining[0].primary = true;
    }
    onChange(remaining);
  };

  const handleSetPrimary = (id: string) => {
    const updated = items.map((i) => ({
      ...i,
      primary: i.id === id,
    }));
    onChange(updated);
  };

  return (
    <div>
      {items.length === 0 && !isAdding && (
        <div className="empty-state">{emptyLabel}</div>
      )}

      {items.map((item) => (
        <div key={item.id}>
          {editingId === item.id ? (
            <div className="animate-fade-in" style={{ marginTop: '6px' }}>
              {renderForm(draft, setDraft)}
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                <button className="btn btn-primary btn-sm" onClick={handleSave}>
                  Save
                </button>
                <button className="btn btn-secondary btn-sm" onClick={handleCancel}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="array-item animate-fade-in">
              <div className="array-item-content">
                {renderItem(item)}
                <div className="array-item-label">
                  {item.label && <span>{item.label}</span>}
                  {showPrimary && item.primary && (
                    <span className="primary-badge">⭐ Primary</span>
                  )}
                </div>
              </div>
              <div className="array-item-actions">
                {copyValue && (
                  <CopyButton value={copyValue(item)} label={item.label} />
                )}
                {showPrimary && !item.primary && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleSetPrimary(item.id)}
                    title="Set as primary"
                  >
                    ⭐
                  </button>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleEdit(item)}
                  title="Edit"
                >
                  ✏️
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => handleDelete(item.id)}
                  title="Delete"
                >
                  🗑
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {isAdding && (
        <div className="animate-fade-in" style={{ marginTop: '8px' }}>
          {renderForm(draft, setDraft)}
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave}>
              Add
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {!isAdding && !editingId && (
        <button className="btn-add" onClick={handleAdd}>
          + {addLabel}
        </button>
      )}
    </div>
  );
}
