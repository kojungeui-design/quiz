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

; ---- 좌표 (coords.txt 에서 채움) ----
Global $X_BATTROW = 55       ; @@ 메인 배터리 행의 X (세로줄 위치)
Global $C_EXPORT[2]  = [810, 308]   ; @@ Export버튼
Global $C_DEST[2]    = [115, 398]   ; @@ 저장경로칸
Global $C_COPY[2]    = [399, 350]   ; @@ Copy버튼
Global $C_OK[2]      = [399, 399]   ; @@ Ok버튼
Global $C_CANCEL[2]  = [505, 447]   ; @@ Test sections Cancel버튼

Func abort($m)
    FileWriteLine($OUT_DIR & "\_export_log.txt", "[중단] " & $m)
    Exit 1
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

; ④ Destination file 입력
MouseClick("left", $C_DEST[0], $C_DEST[1], 1, 10)
Sleep(300)
Send("^a"): Send("{DEL}")
Send($fname, 1)
Sleep(400)

; ⑤ Copy(대상 확정)
MouseClick("left", $C_COPY[0], $C_COPY[1], 1, 10)
Sleep($SLOW)
; 파일 존재 경고 등 뜨면 Yes/Enter
If WinExists("[CLASS:#32770]") Then Send("{ENTER}")
Sleep(300)

; Ok → 변환 시작
MouseClick("left", $C_OK[0], $C_OK[1], 1, 10)

; ⑤ 변환 완료 대기 (진행창이 닫힐 때까지, 최대 10분)
WinWait($CONV_WIN, "", 10)
Local $t = TimerInit()
While WinExists($CONV_WIN)
    If TimerDiff($t) > 600000 Then abort("변환 시간초과 Circ" & $circ)
    Sleep(1000)
WEnd

; ⑥ Test sections 닫기
If WinExists($EXPORT_WIN) Then WinClose($EXPORT_WIN)
Sleep(300)
MouseClick("left", $C_CANCEL[0], $C_CANCEL[1], 1, 10)

FileWriteLine($OUT_DIR & "\_export_log.txt", @HOUR & ":" & @MIN & "  Circ" & $circ & " export 완료 → " & $fname)
