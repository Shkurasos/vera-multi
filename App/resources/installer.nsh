; VERA Multi — the installer remembers the server it was downloaded from.
; When downloading from /downloads the server appends a 1024-byte
; "VERASRV1 <url>\n" trailer to the end of the .exe (Server/download-stamp.js).
; Here we read it from our own file and save it to server-url.txt next to the app,
; which electron/main.js then reads. No trailer means the file is left alone and
; the app uses its built-in address.
!macro customInstall
  ClearErrors
  FileOpen $0 "$EXEPATH" r
  IfErrors vera_stamp_done
  FileSeek $0 -1024 END
  FileRead $0 $1
  FileClose $0
  StrCpy $2 $1 9
  StrCmp $2 "VERASRV1 " 0 vera_stamp_done
  StrCpy $3 $1 "" 9
  ClearErrors
  FileOpen $4 "$INSTDIR\server-url.txt" w
  IfErrors vera_stamp_done
  FileWrite $4 $3
  FileClose $4
  vera_stamp_done:
!macroend

!macro customUnInstall
  Delete "$INSTDIR\server-url.txt"
!macroend
