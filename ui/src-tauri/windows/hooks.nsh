; Popai Animator installer hooks: register / remove the .popai file type
; (double-click opens the app, File Explorer shows the camera-view thumbnail).
!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --register-file-types'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --unregister-file-types'
!macroend
