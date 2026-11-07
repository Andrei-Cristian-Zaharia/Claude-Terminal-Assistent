; Extra steps for the NSIS installer built by electron-builder (package.json build.nsis.include).
; On uninstall (not on an update, which also runs the old uninstaller), the app disconnects Claude
; Code and the shells and removes its Start with Windows entry, which would otherwise point at a
; program that is gone (main.cjs, --uninstall-cleanup).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall-cleanup'
  ${endIf}
!macroend
