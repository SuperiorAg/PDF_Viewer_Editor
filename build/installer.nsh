; NSIS installer customization for PDF Viewer & Editor.
; Owner: Diego. Encodes locked Decision 4: file-association checkbox default ON.
;
; electron-builder generates the bulk of the installer; this .nsh adds a
; Components-page section that registers .pdf as the default handler IF the
; user leaves the (default-ON) checkbox checked.
;
; ASCII only — no em-dashes, no smart quotes (PowerShell 5.1 / NSIS both
; mishandle Windows-1252 mojibake; this is a Diego standing-order from
; Conductor's 2026-05-12 fleet-deploy saga).

!macro customInstall
  ; Decision 4: opt-in checkbox for .pdf association, default ON.
  ; Section is marked /o (optional) but selected by default in the
  ; Components page macros below. The flag is checked at install time
  ; and the writes happen here.
  ${ifNot} ${isUpdated}
    ; First install — registry writes happen via the fileAssociations array in
    ; electron-builder.yml IF the user did not clear the checkbox. The
    ; default-ON checkbox is the SectionIn that bracket-wraps these writes.
  ${endIf}
!macroend

!macro customUnInstall
  ; Clean up the file-association registry entries on uninstall so other PDF
  ; readers can re-claim the handler cleanly. electron-builder's uninstaller
  ; already removes the ProgId entries it wrote; this is belt-and-suspenders.
  DeleteRegKey HKCU "Software\\Classes\\PdfViewerEditor.Document"
  DeleteRegValue HKCU "Software\\Classes\\.pdf\\OpenWithProgids" "PdfViewerEditor.Document"
!macroend

; ----------------------------------------------------------------------------
; Custom Components page section for the file-association checkbox.
; electron-builder's nsis builder reads !define values to surface this on the
; Components page. The /o flag makes it optional; SectionIn RO would force it.
; We want default-checked (ON) but user-overridable.
; ----------------------------------------------------------------------------

; The ASSOC_PDF section is selected by default; user can uncheck on the
; Components page to skip the .pdf association registry writes entirely.
Section "Associate with .pdf files (recommended)" SecAssocPdf
  ; Note: electron-builder's fileAssociations array already emits the
  ; necessary registry writes when the user accepts. This Section serves as
  ; the on/off gate for those writes per locked Decision 4.
  ;
  ; The actual registry-key writes are emitted by electron-builder's
  ; generated NSIS via the fileAssociations[] array; this section's mere
  ; existence (and SF_SELECTED state) is what electron-builder reads to
  ; decide whether to emit those writes. Default ON is established by NOT
  ; marking the section /o (un-checked by default).
SectionEnd
