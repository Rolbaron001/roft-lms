# LMS Handoff Note: .pptx Compatibility Defect (LibreOffice "General input/output error")

**Date:** 19 November 2026
**Raised by:** Roland Jones
**Applies to:** LMS app, content ingestion and learner delivery of PowerPoint study material
**Status:** Root cause confirmed and fix proven on a test copy. No production files were changed.

---

## 1. Summary

Twelve of the fourteen .pptx study files in the RPL Advisor (SP 260508) learning material will not open in LibreOffice Impress. They fail with "General Error. General input/output error." Microsoft PowerPoint opens the same files without complaint, so the defect is invisible to anyone who checks the material only in PowerPoint.

The fault is in the files, not in LibreOffice. A script has rewritten three internal XML parts of each file using non-standard namespace prefixes (`ns0:`). PowerPoint tolerates this. LibreOffice does not.

**Why this matters for the LMS:** learners will open study material in whatever software they have. Many will use LibreOffice, Google Slides, Keynote, mobile viewers or a browser previewer, not PowerPoint. Any file carrying this defect fails for those learners, while it looks fine to the people who produced it.

---

## 2. Evidence

| Test | Result |
|---|---|
| LibreOffice 26.8.3.1 install integrity (D:\Program Files\LibreOffice) | Complete. 1,681 files, 464 MB. Not the cause. |
| Older BMA presentation (July 2026) opened in the same LibreOffice | Opens and converts to PDF correctly |
| RPL KM1 KT1.pptx opened with a fresh, clean LibreOffice profile | Fails: "source file could not be loaded" |
| Same file copied to a different drive (C:\ temp) | Still fails. Not a path, drive or lock-file issue. |
| Zip integrity of all 14 .pptx files | All valid zips. No broken internal links, all XML well-formed. |
| Scan for `ns0:`-prefixed package parts | **12 files affected, 2 clean. The two clean files are exactly the two that open.** |
| Repaired copy of KM1 KT1 (prefixes normalised, nothing else changed) | Opens in LibreOffice. 13 of 13 slides rendered to PDF. |
| The 38 .docx files in the same folder | None affected |

**Affected files:** RPL KM1 KT1 to KT5, KM2 KT1 to KT5, KM3 KT1 and KT2.
**Clean files:** RPL KM3 KT3 and KM3 KT4.

**The three rewritten parts, identical in every affected file:**

- `[Content_Types].xml`
- `ppt/presentation.xml`
- `ppt/_rels/presentation.xml.rels`

**What the defect looks like:**

```xml
<!-- Standard form (what LibreOffice expects) -->
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>

<!-- Defective form found in the affected files -->
<ns0:Types xmlns:ns0="http://schemas.openxmlformats.org/package/2006/content-types">
  <ns0:Default Extension="xml" ContentType="application/xml" />
```

The two are technically equivalent XML, but LibreOffice's package reader expects the standard form.

---

## 3. Root Cause

The affected files were first saved by Microsoft PowerPoint for Mac (per `docProps/app.xml`). Afterwards, a script edited them and saved them again.

The `ns0:`, `ns1:` prefix pattern is the default output of Python's built-in `xml.etree.ElementTree` when it writes XML without namespace registration. The most likely cause is that some generation or post-processing step (for example adding or reordering slides, or adjusting slide lists) parsed these parts with ElementTree and wrote them back out.

**Action for the LMS project:** identify which tool, script or pipeline produced these files and correct it at source (see 4.1).

---

## 4. Recommendations for the LMS

### 4.1 Fix at source: any code that edits Office files

- Prefer a purpose-built library (`python-pptx`, `python-docx`, `openpyxl`) over hand-editing the XML.
- If raw XML must be edited, use `lxml`, which preserves the original prefixes, rather than `xml.etree.ElementTree`.
- If `ElementTree` must be used, register every namespace before writing, for example:
  ```python
  ET.register_namespace('', 'http://schemas.openxmlformats.org/package/2006/content-types')
  ```
- Never re-serialise `[Content_Types].xml` or `.rels` files unless strictly necessary.
- Every file a pipeline produces must pass the validation gate in 4.2 before release.

### 4.2 Validation gate at content upload or ingestion

Every .pptx, .docx and .xlsx uploaded to the LMS should be checked automatically before learners can see it:

1. **Zip integrity:** the file opens as a zip and every part passes a CRC check.
2. **Namespace check:** no package part (`.xml` or `.rels`) begins with an `<nsN:` prefixed root element.
3. **Relationship check:** every internal relationship target exists in the package.
4. **Render test (strongest check):** headless LibreOffice conversion to PDF must succeed, and the page count must equal the slide count:
   ```
   soffice --headless --convert-to pdf --outdir <out> <file.pptx>
   ```
   If the PDF is missing or the page count differs, reject the file and report the reason to the uploader.

Checks 1 to 3 are fast and dependency-free. Check 4 needs LibreOffice on the server, but it is the only check that proves a real learner can open the file.

### 4.3 Automatic repair (optional)

The defect can be repaired safely: change the prefixed elements back to the default namespace in the affected parts and leave everything else byte-for-byte as it was. This was proven on RPL KM1 KT1 (13 of 13 slides intact). It can run as a repair step that triggers when check 2 fails, followed by check 4 to confirm the result.

Reference logic (Python, standard library only):

```python
import zipfile, re

def repair_ooxml(src, dst):
    zin = zipfile.ZipFile(src)
    zout = zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED)
    names = ["[Content_Types].xml"] + [n for n in zin.namelist() if n != "[Content_Types].xml"]
    for n in names:
        data = zin.read(n)
        if n.endswith((".xml", ".rels")) and re.search(rb"<ns\d+:", data[:400]):
            s = data.decode("utf-8")
            prefix = re.search(r'<(ns\d+):', s).group(1)   # prefix of the root element
            s = (s.replace(f"xmlns:{prefix}=", "xmlns=")
                  .replace(f"<{prefix}:", "<")
                  .replace(f"</{prefix}:", "</"))
            data = s.encode("utf-8")
        zout.writestr(zin.getinfo(n), data, compress_type=zipfile.ZIP_DEFLATED)
    zout.close()
```

Note: this handles the root element's prefix, which is the pattern found here. Harden it before production, for example by using lxml to strip all generated prefixes properly and by guarding against attributes that carry the same prefix.

### 4.4 Delivery format for learners

Study material that learners only need to read should not depend on the learner's office software. Options, from most to least robust:

1. **Convert to PDF at upload** (using the same LibreOffice step as 4.2) and show the PDF in the LMS viewer as the primary format. Offer the .pptx as an optional download only.
2. **Render slides to images or HTML** for in-browser viewing on any device, including phones.
3. **Deliver .pptx only.** Not recommended for learner-facing material.

### 4.5 Test matrix before a course is released

Spot-check at least one file per module in:

- Microsoft PowerPoint (Windows and Mac)
- LibreOffice Impress (current version)
- Google Slides (upload and open)
- Apple Keynote or iOS preview
- An Android viewer
- The LMS's own in-browser viewer

---

## 5. Open Questions for the LMS Project

1. Which tool or script produced the RPL .pptx files after they were saved in PowerPoint for Mac? Does the same step run on other courses?
2. Should the LMS reject defective files, or repair them automatically and log the repair?
3. Will the LMS server have LibreOffice available for the render test and PDF conversion? If not, which conversion service will be used?
4. Is PDF the primary learner format for slide material, with .pptx as an optional download?
5. Should existing course material already in the LMS be scanned retrospectively with the 4.2 checks?

---

## 6. Status of the Source Files

The RPL Advisor folder is being replaced, so the 12 affected files were deliberately **not** repaired. The replacement material should go through the 4.2 checks before it is used. A test folder called `_LibreOffice fix test` (containing the repaired test copy and its PDF) remains in the old folder and can be discarded with it.
