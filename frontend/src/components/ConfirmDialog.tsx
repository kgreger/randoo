interface Props {
  text: string;
  hint?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ text, hint, confirmLabel, cancelLabel, onConfirm, onCancel }: Props) {
  return (
    <div className="map-empty">
      <div className="map-empty-card signin-card">
        <div className="account-field-group">
          <p className="confirm-text">{text}</p>
          {hint && <p className="account-hint">{hint}</p>}
          <button className="btn btn-primary" onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
