; =====================================================================
; 회로 1개 자동 Export (좌표 기반, 안전) — 영상 분석으로 확정한 실제 흐름
;
; 확인된 흐름:
;   ① 메인 그리드에서 대상 배터리 행 '더블클릭' → Test sections 창 열림
;   ② 맨 아래(가장 최근=방금 끝난) 시험 구간이 자동 선택됨
;   ③ Export 버튼 → "Battery - Data export" 대화상자
;      (Convert to=Excel, Type=File 은 기본값 유지)
;   ④ Destination file 지우고 CIRCnnnn.csv 입력
;   ⑤ Copy(대상 확정) → (파일존재 경고 시 Yes) → Ok
;   ⑤ "Data file conversion" 진행창 뜸 → 닫힐 때까지 대기 (변환에 시간 걸림)
;   ⑥ Test sections 창 Cancel 로 닫고 종료
;
; 실행:  AutoIt3.exe export_circuit.au3 <회로번호> <행Y좌표>
;   행Y좌표 = 완료 감지 스크린샷에서 그 회로가 있는 화면상의 세로 위치(px)
;
; ※ 아래 좌표(@@)는 capture_coords.au3 로 딴 값으로 채운다.
; =====================================================================

Global $OUT_DIR = "E:\bts_csv"
Global $BTS = "BTS-600"
Global $EXPORT_WIN = "Battery - Data export"
Global $CONV_WIN = "Data file conversion"
Global $SLOW = 700

; ---- 좌표 (1920x1080 전체화면 스크린샷에서 측정, ±수px 가능) ----
; 메인 그리드: Batt0007행 y=202, 행높이 약 17px → 대상행 y = 202 + 17*순번
Global $X_BATTROW = 55       ; 배터리 열 X
Global $C_EXPORT[2]  = [810, 278]   ; Export버튼 (Test sections 창)
Global $C_DEST[2]    = [180, 565]   ; Destination file 입력칸
Global $C_COPY[2]    = [640, 487]   ; Copy버튼 (대상 확정)
Global $C_OK[2]      = [640, 567]   ; Ok버튼
Global $C_CANCEL[2]  = [810, 644]   ; Test sections Cancel버튼

Func abort($m)
    FileWriteLine($OUT_DIR & "\_export_log.txt", "[중단] " & $m)
    Exit 1
EndFunc

; 버튼 이름으로 클릭(우선), 실패 시 좌표로 클릭
Func clickBtn($win, $text, $x, $y)
    If ControlClick($win, "", "[TEXT:" & $text & "]") = 0 Then MouseClick("left", $x, $y, 1, 15)
EndFunc

If $CmdLine[0] < 2 Then Exit
Local $circ = Number($CmdLine[1])
Local $rowY = Number($CmdLine[2])
Local $fname = $OUT_DIR & "\CIRC" & StringFormat("%04d", $circ) & ".csv"
If Not FileExists($OUT_DIR) Then DirCreate($OUT_DIR)

WinActivate($BTS)
If Not WinWaitActive($BTS, "", 10) Then abort("BTS 창 없음")

; ① 대상 배터리 행 더블클릭 → Test sections 열림
MouseClick("left", $X_BATTROW, $rowY, 2, 15)   ; 더블클릭
Sleep($SLOW * 2)

; ③ Export
MouseClick("left", $C_EXPORT[0], $C_EXPORT[1], 1, 15)
If Not WinWait($EXPORT_WIN, "", 8) Then abort("Export 창 안뜸")
WinActivate($EXPORT_WIN)
Sleep($SLOW)

; ④ Destination file: 기존 이름 지우고 새 파일명 입력 (구형 앱 호환 방식)
MouseClick("left", $C_DEST[0], $C_DEST[1], 1, 10)
Sleep(300)
Send("{END}")           ; 커서 맨 뒤로
Send("+{HOME}")         ; Shift+Home 으로 전체 선택
Send("{DEL}")           ; 선택 삭제
Sleep(150)
Send($fname, 1)         ; 새 파일명 그대로 타이핑 (예: E:\bts_csv\CIRC0024.csv)
Sleep(400)

; ⑤ Copy(대상 확정) — 버튼 이름으로 클릭
clickBtn($EXPORT_WIN, "Copy", $C_COPY[0], $C_COPY[1])
Sleep($SLOW)
; "This data file exists already! Overwrite?" 경고 → Yes 클릭
Local $ov = WinWait("", "data file exists", 3)
If $ov <> 0 Then
    ControlClick($ov, "", "[TEXT:Yes]")
    Sleep(400)
EndIf

; ⑥ Ok → 변환 시작 (버튼 이름으로 클릭)
Sleep(300)
clickBtn($EXPORT_WIN, "Ok", $C_OK[0], $C_OK[1])

; ⑦ 변환 완료 대기 (진행창이 닫힐 때까지, 최대 15분)
WinWait($CONV_WIN, "", 15)
Local $t = TimerInit()
While WinExists($CONV_WIN)
    If TimerDiff($t) > 900000 Then abort("변환 15분 초과 Circ" & $circ)
    Sleep(2000)
WEnd

; ⑥ Test sections 닫기
If WinExists($EXPORT_WIN) Then WinClose($EXPORT_WIN)
Sleep(300)
MouseClick("left", $C_CANCEL[0], $C_CANCEL[1], 1, 10)

FileWriteLine($OUT_DIR & "\_export_log.txt", @HOUR & ":" & @MIN & "  Circ" & $circ & " export 완료 → " & $fname)
