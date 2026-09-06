interface Props {
  onFileSelected: (file: File) => void;
  fileName: string | null;
}

export function UploadPanel({ onFileSelected, fileName }: Props) {
  return (
    <div className="upload-panel">
      <input
        type="file"
        accept=".gpx"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
        }}
      />
      {fileName && <div style={{ marginTop: 8 }}>{fileName}</div>}
    </div>
  );
}
