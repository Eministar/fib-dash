; Nur unseren Autostart entfernen, wenn die App deinstalliert wird.
!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "FIB Desktop"
!macroend
