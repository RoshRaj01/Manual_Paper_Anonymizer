import fitz  # PyMuPDF
import os
import tempfile
import shutil


def remove_text_from_pdf(input_pdf, output_pdf, selections, ack_pdf=None):
    doc = fitz.open(input_pdf)

    # Only run the redaction engine if there are actual selections
    if selections:
        for sel in selections:
            page = doc[sel["page"]]
            rect = fitz.Rect(sel["bbox"])
            words = page.get_text("words")

            for w in words:
                w_rect = fitz.Rect(w[:4])
                if rect.intersects(w_rect):
                    overlap = rect & w_rect
                    word_area = w_rect.width * w_rect.height
                    overlap_area = overlap.width * overlap.height

                    if word_area > 0 and (overlap_area / word_area) > 0.20:
                        page.add_redact_annot(w_rect, fill=(1, 1, 1))

        for page in doc:
            page.apply_redactions()

    # Merge or Save (using temp files to avoid Windows Permission Errors)
    if ack_pdf and os.path.exists(ack_pdf):
        final_doc = fitz.open(ack_pdf)
        final_doc.insert_pdf(doc)

        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
        os.close(tmp_fd)
        final_doc.save(tmp_path)
        final_doc.close()
        doc.close()
        shutil.move(tmp_path, output_pdf)
    else:
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
        os.close(tmp_fd)
        doc.save(tmp_path)
        doc.close()
        shutil.move(tmp_path, output_pdf)


def remove_metadata(pdf_path: str):
    """Strip all metadata from a PDF in-place using a safe temp-file swap."""
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
    os.close(tmp_fd)
    try:
        doc = fitz.open(pdf_path)
        doc.set_metadata({})
        doc.del_xml_metadata()
        doc.save(tmp_path, garbage=4, deflate=True, clean=True)
        doc.close()
        shutil.move(tmp_path, pdf_path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise