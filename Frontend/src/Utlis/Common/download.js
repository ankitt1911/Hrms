const sanitizeFilename = (name) => String(name || "download").replace(/[\\/:*?"<>|]+/g, "-");

export const downloadBase64File = ({ contentBase64, contentType = "application/octet-stream", filename = "download" }) => {
  if (!contentBase64) throw new TypeError("Missing download content");
  const binary = globalThis.atob(contentBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = sanitizeFilename(filename);
  anchor.rel = "noopener";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const openSignedDownload = ({ url }) => {
  if (!url) throw new TypeError("Missing signed download URL");
  const parsedUrl = new URL(url, window.location.origin);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new TypeError("Unsupported download URL protocol");
  const opened = window.open(parsedUrl.href, "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(parsedUrl.href);
};
