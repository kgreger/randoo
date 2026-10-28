import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { strToU8, zipSync } from "fflate";
import { useTranslation } from "react-i18next";
import type { ExportPart } from "../lib/api";

interface Props {
  coursePoints: number;
  limit: number;
  // How many files the route is cut into.
  parts: number;
  // The course name the file carries, which the rider can change.
  defaultName: string;
  onExportOne: () => void;
  onSplit: (courseName: string) => Promise<ExportPart[]>;
  onClose: () => void;
}

// The name each part gets, as the backend writes it (see split.part_name): the
// number of the part and of all parts in front, with a dot because a slash
// cannot be part of a file name.
function partLabel(name: string, index: number, total: number): string {
  return `${index}.${total} ${name.trim() || "randoo-pois"}`;
}

function archiveName(name: string): string {
  return `${name.trim().replace(/[\\/:*?"<>|]/g, "-") || "randoo-pois"}.zip`;
}

interface Download {
  part: ExportPart;
  url: string;
}

// Shown when an export has more course points than the device takes: the
// rider exports as one file anyway, or has the route split into several
// files, named and downloaded one by one or all at once as a ZIP.
export function SplitExportDialog({
  coursePoints,
  limit,
  parts,
  defaultName,
  onExportOne,
  onSplit,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"choose" | "name" | "done">("choose");
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [zipUrl, setZipUrl] = useState<string | null>(null);

  useEffect(
    () => () => {
      downloads.forEach((download) => URL.revokeObjectURL(download.url));
      if (zipUrl) URL.revokeObjectURL(zipUrl);
    },
    [downloads, zipUrl],
  );

  async function split() {
    setBusy(true);
    setError(false);
    try {
      const result = await onSplit(name.trim());
      setDownloads(
        result.map((part) => ({
          part,
          url: URL.createObjectURL(new Blob([part.gpx], { type: "application/gpx+xml" })),
        })),
      );
      const archive = zipSync(Object.fromEntries(result.map((part) => [part.filename, strToU8(part.gpx)])));
      setZipUrl(URL.createObjectURL(new Blob([archive], { type: "application/zip" })));
      setStep("done");
    } catch (err) {
      console.error("Splitting the export failed", err);
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="map-empty">
      <div className="map-empty-card signin-card">
        <button className="dialog-close" onClick={onClose} aria-label={t("account.close")}>
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>

        <div className="account-field-group">
          {step === "choose" && (
            <>
              <p className="confirm-text">{t("pointLimit.text", { count: coursePoints, limit })}</p>
              <p className="account-hint">{t("pointLimit.hint")}</p>
              <button className="btn btn-primary" onClick={() => setStep("name")} autoFocus>
                {t("pointLimit.split", { count: parts })}
              </button>
              <button className="btn btn-ghost" onClick={onExportOne}>
                {t("pointLimit.confirm")}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>
                {t("pointLimit.cancel")}
              </button>
            </>
          )}

          {step === "name" && (
            <>
              <label className="account-field-label" htmlFor="course-name">
                {t("pointLimit.nameLabel")}
              </label>
              <input
                id="course-name"
                className="field-input"
                type="text"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => e.key === "Enter" && !busy && split()}
                autoFocus
              />
              <p className="account-hint">{t("pointLimit.nameHint")}</p>
              <ul className="split-preview">
                {Array.from({ length: parts }, (_, i) => (
                  <li key={i}>{partLabel(name, i + 1, parts)}</li>
                ))}
              </ul>
              <button className="btn btn-primary" onClick={split} disabled={busy}>
                {busy ? t("pointLimit.splitting") : t("pointLimit.splitConfirm")}
              </button>
              {error && <p className="account-error">{t("pointLimit.errorSplit")}</p>}
            </>
          )}

          {step === "done" && (
            <>
              <p className="confirm-text">{t("pointLimit.done", { count: downloads.length })}</p>
              {downloads.map(({ part, url }) => (
                <a key={part.filename} className="btn btn-primary btn-link" href={url} download={part.filename}>
                  <Download size={15} strokeWidth={2} aria-hidden="true" />
                  <span className="split-file-name">{part.name}</span>
                </a>
              ))}
              {zipUrl && (
                <>
                  <a className="btn btn-ghost btn-link" href={zipUrl} download={archiveName(name)}>
                    <Download size={15} strokeWidth={2} aria-hidden="true" />
                    {t("pointLimit.zip")}
                  </a>
                  <p className="account-hint">{t("pointLimit.zipHint")}</p>
                </>
              )}
              <button className="btn btn-ghost" onClick={onClose}>
                {t("pointLimit.close")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
