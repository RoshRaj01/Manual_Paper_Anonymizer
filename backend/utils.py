import os

SUPPORTED_EXTENSIONS = (".pdf", ".doc", ".docx")


def list_files(folder: str) -> list:
    """
    Recursively list all supported files under `folder`.
    Returns paths relative to `folder` so the UI can display them cleanly
    and the backend can reconstruct full paths with os.path.join(folder, rel_path).
    """
    if not folder or not os.path.exists(folder):
        return []

    results = []
    for dirpath, dirnames, filenames in os.walk(folder):
        # Skip hidden dirs
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]

        for fname in sorted(filenames):
            if fname.lower().endswith(SUPPORTED_EXTENSIONS):
                full = os.path.join(dirpath, fname)
                rel = os.path.relpath(full, folder)
                results.append(rel.replace("\\", "/"))  # normalize to forward slashes

    return sorted(results)