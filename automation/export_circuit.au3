; =====================================================================
; 회로 1개 자동 Export (좌표 기반, 안전)
;
; 완료 감지된 회로를 export한다. Finder Tool을 안 쓰고 '정해진 위치 클릭'만
; 하므로 사람이 클릭하는 것과 같아 프로그램 크래시 위험이 낮다.
;
; 실행:  export_circuit.au3  <회로번호>
;   예)  AutoIt3.exe export_circuit.au3 24
;
; ※ 아래 좌표(@@)는 capture_coords.au3 로 딴 coords.txt 값으로 채운다.
; ※ 배터리 '이동/선택' 방법은 실제 화면 흐름 확인 후 확정 (아래 [이동] 부분).
; =====================================================================

Global $OUT_DIR = "E:\bts_csv"
Global $BTS = "BTS-600"
Global $EXPORT_WIN = "Battery - Data export"
Global $SLOW = 800     ; 각 동작 사이 대기(ms) — 낡은 앱 보호용, 넉넉히

; ---- 좌표 (coords.txt 에서 채움) ----
Global $C_EXPORT[2]   = [810, 308]   ; @@ Export버튼
Global $C_FORMAT[2]   = [170, 226]   ; @@ 형식드롭다운
Global $C_DEST[2]     = [170, 544]   ; @@ 저장경로칸
Global $C_OK[2]       = [631, 545]   ; @@ Ok버튼
Global $C_BATTLIST[2] = [ 55, 214]   ; @@ 배터리목록_첫항목
Global $C_SECTION[2]  = [110, 780]   ; @@ 시험목록_첫항목(맨아래=최근)

Func clk($c)
    MouseClick("left", $c[0], $c[1], 1, 10)
    Sleep($SLOW)
EndFunc

Func abort($msg)
    ; 크래시/에러창 감지 시 안전 중단
    FileWriteLine($OUT_DIR & "\_export_log.txt", "[중단] " & $msg)
    Exit 1
EndFunc

; ---- 시작 ----
If $CmdLine[0] < 1 Then Exit
Local $circ = Number($CmdLine[1])
Local $fname = $OUT_DIR & "\CIRC" & StringFormat("%04d", $circ) & ".csv"
If Not FileExists($OUT_DIR) Then DirCreate($OUT_DIR)

WinActivate($BTS)
If Not WinWaitActive($BTS, "", 10) Then abort("BTS 창 없음")

; [이동] 대상 배터리/회로의 Test sections 열기 --------------------------
;   [확정필요] 메인 화면 → 특정 배터리(Batt00NN) test sections 여는 방법.
;   예상: 배터리 목록에서 해당 행 클릭/더블클릭. 실제 흐름 확인 후 채움.
;   (여기서 대상 배터리로 이동)

; 최근(맨 아래) 시험 구간 선택 = 방금 끝난 시험
clk($C_SECTION)

; Export 버튼
clk($C_EXPORT)
If Not WinWait($EXPORT_WIN, "", 8) Then abort("Export 창 안뜸")
WinActivate($EXPORT_WIN)

; 형식 = Excel/ASCII (드롭다운은 기본값이 유지되면 생략 가능)
; clk($C_FORMAT)  ; 필요시 열어서 선택

; 저장 경로 입력
MouseClick("left", $C_DEST[0], $C_DEST[1], 1, 10)
Sleep(300)
Send("^a"): Send("{DEL}")           ; 기존 내용 지우기
Send($fname, 1)                     ; 파일명 그대로 타이핑
Sleep(300)

; Ok
MouseClick("left", $C_OK[0], $C_OK[1], 1, 10)
Sleep($SLOW)

; 덮어쓰기 경고 등 뜨면 Yes/Enter
If WinExists("[CLASS:#32770]") Then Send("{ENTER}")

FileWriteLine($OUT_DIR & "\_export_log.txt", @HOUR & ":" & @MIN & "  Circ" & $circ & " export → " & $fname)
