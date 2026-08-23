; ============================================================================
; Ollama+ Custom NSIS Installer Script
; ============================================================================
; This file is included by electron-builder via the nsis.include configuration.
; electron-builder calls the defined macros at specific lifecycle points:
;   - customHeader: Declare variables, define constants
;   - customInit: Run on installer start
;   - customInstall: Post-extraction hooks
; ============================================================================

!include "LogicLib.nsh"

; === customHeader macro ===
!macro customHeader
  !include "MUI2.nsh"
!macroend

; === customInit macro ===
!macro customInit
  ; Prerequisite detection runs on installer start.
  ; Future: detect Ollama runtime and VC++ Redistributable here.
!macroend

; === customInstall macro ===
!macro customInstall
  ; Post-extraction hooks.
  ; Future: verify shortcuts and registry entries here.
!macroend
