; Register supported types without writing extension defaults or UserChoice.
; SHELL_CONTEXT follows the installer's current-user / per-machine install mode.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHELL_CONTEXT "Software\Classes\ZNote.Markdown" "" "Markdown document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ZNote.Markdown" "FriendlyTypeName" "Markdown document"
  ; The bundled document icon is separate from the executable's application icon.
  ; Rewrite on upgrades too, replacing the EXE icon registered by older versions.
  WriteRegStr SHELL_CONTEXT "Software\Classes\ZNote.Markdown\DefaultIcon" "" '$\"$INSTDIR\icons\markdown.ico$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\ZNote.Markdown\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\.md\OpenWithProgids" "ZNote.Markdown" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.markdown\OpenWithProgids" "ZNote.Markdown" ""

  ; Generic registration for the other supported open types; no UserChoice is written.
  WriteRegStr SHELL_CONTEXT "Software\Classes\ZNote.Document" "" "Znote document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ZNote.Document" "FriendlyTypeName" "Znote document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ZNote.Document\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  !macro ZNOTE_REGISTER_ASSOCIATION EXT
    WriteRegStr SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "ZNote.Document" ""
    WriteRegStr SHELL_CONTEXT "Software\ZNote\Capabilities\FileAssociations" "${EXT}" "ZNote.Document"
  !macroend
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".mdx"
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".txt"
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".html"
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".htm"
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".drawio"
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".excalidraw"
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".pdf"
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".png"
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".jpg"
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".jpeg"
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".gif"
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".webp"
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".svg"
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".bmp"
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".ico"
  !insertmacro ZNOTE_REGISTER_ASSOCIATION ".avif"

  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".md" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".markdown" ""
  !macro ZNOTE_ADD_SUPPORTED_TYPE EXT
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" "${EXT}" ""
  !macroend
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".mdx"
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".txt"
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".html"
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".htm"
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".drawio"
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".excalidraw"
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".pdf"
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".png"
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".jpg"
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".jpeg"
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".gif"
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".webp"
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".svg"
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".bmp"
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".ico"
  !insertmacro ZNOTE_ADD_SUPPORTED_TYPE ".avif"

  WriteRegStr SHELL_CONTEXT "Software\ZNote\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHELL_CONTEXT "Software\ZNote\Capabilities" "ApplicationDescription" "Local Markdown editor and reader"
  WriteRegStr SHELL_CONTEXT "Software\ZNote\Capabilities" "ApplicationIcon" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
  WriteRegStr SHELL_CONTEXT "Software\ZNote\Capabilities\FileAssociations" ".md" "ZNote.Markdown"
  WriteRegStr SHELL_CONTEXT "Software\ZNote\Capabilities\FileAssociations" ".markdown" "ZNote.Markdown"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "ZNote" "Software\ZNote\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.md\OpenWithProgids" "ZNote.Markdown"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.markdown\OpenWithProgids" "ZNote.Markdown"
  !macro ZNOTE_UNREGISTER_ASSOCIATION EXT
    DeleteRegValue SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "ZNote.Document"
    DeleteRegValue SHELL_CONTEXT "Software\ZNote\Capabilities\FileAssociations" "${EXT}"
  !macroend
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".mdx"
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".txt"
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".html"
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".htm"
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".drawio"
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".excalidraw"
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".pdf"
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".png"
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".jpg"
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".jpeg"
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".gif"
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".webp"
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".svg"
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".bmp"
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".ico"
  !insertmacro ZNOTE_UNREGISTER_ASSOCIATION ".avif"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\ZNote.Document"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\ZNote.Markdown"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "ZNote"
  DeleteRegKey SHELL_CONTEXT "Software\ZNote\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
