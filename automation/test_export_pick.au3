; =====================================================================
; 아무 회로나 자동 Export 테스트
; 맨 위 두 값(회로번호, 행index)만 바꾸면 그 회로를 자동 export.
; 행index: 화면 목록에서 몇 번째 줄인지 (Batt0007=0, 0008=1, ... 0015=8)
; =====================================================================

Global $CIRC   = 15      ; ← export할 회로번호 (예: 15 = Circ0015)
Global $ROWIDX = 8       ; ← 그 회로가 화면 몇 번째 줄인지 (Circ0015 = 8번째)

Global $BTS = "BTS-600"
Global $EXPORT_WIN = "Battery - Data export"
Global $CONV_WIN = "Data file conversion"
Global $OUT_DIR = "E:\bts_csv"
Global $BASE_Y = 202, $ROW_H = 16.2, $COL_X = 55   ; 확인된 2점(Batt0007=202, Batt0016=348)으로 보정
Global $fname = $OUT_DIR & "\CIRC" & StringFormat("%04d", $CIRC) & ".csv"
Global $rowY = Int($BASE_Y + $ROW_H * $ROWIDX)

Global $EXPORT[2] = [810, 278], $DEST[2] = [180, 565]
Global $COPY[2] = [640, 487], $OK[2] = [640, 567], $CANCEL[2] = [810, 644]

Func note($m)
    ToolTip($m, 10, 10)
EndFunc
Func stop_($m)
    note("[중단] " & $m)
    Sleep(3000)
    Exit
EndFunc
Func clickBtn($win, $t, $x, $y)
    If ControlClick($win, "", "[TEXT:" & $t & "]") = 0 Then MouseClick("left", $x, $y, 1, 15)
EndFunc

If Not FileExists($OUT_DIR) Then DirCreate($OUT_DIR)
note("Circ" & StringFormat("%04d", $CIRC) & " (줄 " & $ROWIDX & ", y=" & $rowY & ") export — 4초 후 시작")
Sleep(4000)

If Not WinActivate($BTS) Then stop_("BTS 창 없음")
WinWaitActive($BTS, "", 8)
Sleep(800)

note("① 회로 줄 더블클릭 (y=" & $rowY & ")")
MouseClick("left", $COL_X, $rowY, 2, 20)
Sleep(1500)

note("② Export")
MouseClick("left", $EXPORT[0], $EXPORT[1], 1, 20)
If Not WinWait($EXPORT_WIN, "", 8) Then stop_("Export 창 안뜸 — 회로 선택/좌표 확인")
WinActivate($EXPORT_WIN)
Sleep(800)

note("③ 파일명 입력: " & $fname)
MouseClick("left", $DEST[0], $DEST[1], 1, 15)
Sleep(400)
Send("{END}")
Send("+{HOME}")
Send("{DEL}")
Sleep(200)
Send($fname, 1)
Sleep(600)

note("④ Copy")
clickBtn($EXPORT_WIN, "Copy", $COPY[0], $COPY[1])
Sleep(1000)
Local $ov = WinWait("", "data file exists", 3)
If $ov <> 0 Then
    ControlClick($ov, "", "[TEXT:Yes]")
    Sleep(500)
EndIf

note("⑤ Ok — 변환 시작")
Sleep(300)
clickBtn($EXPORT_WIN, "Ok", $OK[0], $OK[1])

If WinWait($CONV_WIN, "", 15) Then
    Local $t = TimerInit()
    While WinExists($CONV_WIN)
        note("⑥ 변환 중... " & Round(TimerDiff($t) / 60000, 1) & "분 경과")
        If TimerDiff($t) > 900000 Then stop_("변환 15분 초과")
        Sleep(2000)
    WEnd
EndIf

If WinExists($EXPORT_WIN) Then WinClose($EXPORT_WIN)
Sleep(400)
MouseClick("left", $CANCEL[0], $CANCEL[1], 1, 15)
note("✅ 완료! E:\bts_csv\CIRC" & StringFormat("%04d", $CIRC) & ".csv 확인하세요.")
Sleep(4000)
