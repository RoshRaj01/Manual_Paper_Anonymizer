import os

def convert_to_pdf(input_path: str, output_path: str):
    """
    Convert a DOC/DOCX file to PDF using Microsoft Word COM automation.
    Requires Windows + Microsoft Word installed.
    """
    try:
        import win32com.client
    except ImportError:
        raise RuntimeError(
            "pywin32 is not installed. Run: pip install pywin32\n"
            "Also run: python -m win32com.client.makepy after installing."
        )

    # Word COM requires absolute paths
    input_path = os.path.abspath(input_path)
    output_path = os.path.abspath(output_path)

    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path}")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    word = None
    doc = None
    try:
        word = win32com.client.Dispatch("Word.Application")
        word.Visible = False
        word.DisplayAlerts = False

        doc = word.Documents.Open(input_path, ReadOnly=True)
        # 17 = wdFormatPDF
        doc.SaveAs(output_path, FileFormat=17)

    except Exception as e:
        raise RuntimeError(f"Word COM conversion failed: {e}") from e

    finally:
        # Always clean up COM objects to avoid Word hanging
        try:
            if doc is not None:
                doc.Close(False)  # False = don't save changes
        except Exception:
            pass
        try:
            if word is not None:
                word.Quit()
        except Exception:
            pass

    if not os.path.exists(output_path):
        raise RuntimeError(f"Conversion succeeded but output file not found: {output_path}")