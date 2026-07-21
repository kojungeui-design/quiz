; =====================================================================
; BTS-600 일일 Export 자동화 (AutoIt)
; 실제 화면(Test sections 창 + Battery - Data export 대화상자) 기반.
;
; 확인된 export 흐름:
;   배터리 선택 → Test sections 목록에서 대상 시험 선택 → Export 버튼
;   → "Battery - Data export" 창:
;        Convert to:  Excel (또는 ASCII)
;        Type of conversion:  File (라디오)
;        Destination file:  저장 경로 입력  (예: E:\CIRC0011.csv)
;        → Ok
;
; ※ 남은 튜닝(실제 PC에서): 컨트롤 ID(AutoIt Window Info로 캡처),
;   그리고 40개 배터리를 순회 선택하는 방법.
; =====================================================================

Global $OUT_DIR = "E:\bts_csv"          ; 저장 폴더 (E: 드라이브)
Global $BTS = "BTS-600"                 ; 메인 창 제목 일부
Global $EXPORT_WIN = "Battery - Data export"
Global $N = 40                          ; 회로/배터리 수
Global $FORMAT = "Excel"                ; "Excel" 또는 "ASCII"

If Not FileExists($OUT_DIR) Then DirCreate($OUT_DIR)

WinActivate($BTS)
WinWaitActive($BTS, "", 15)
Sleep(800)

For $i = 1 To $N
    ; ── (1) i번째 배터리 선택 ──────────────────────────────
    ; [튜닝필요] 배터리 목록에서 Batt00NN 선택.
    ;   방법 A) 배터리 리스트 컨트롤에서 항목 클릭
    ;   방법 B) 목록 첫 항목 클릭 후 Down 키 (i-1)회 이동
    ; 예: ControlClick($BTS, "", "[CLASS:...; INSTANCE:...]")

    ; ── (2) Test sections 목록에서 대상 시험 선택 ───────────
    ; [튜닝필요] 보통 '가장 최근/진행 중' 시험 = 목록 맨 아래 항목.
    ;   Test sections 리스트에서 마지막 행 선택 (End 키 등)

    ; ── (3) Export 버튼 클릭 ────────────────────────────────
    ControlClick($BTS, "", "[TEXT:Export]")

    ; ── (4) Data export 대화상자 처리 ──────────────────────
    WinWait($EXPORT_WIN, "", 10)
    WinActivate($EXPORT_WIN)
    WinWaitActive($EXPORT_WIN, "", 5)

    ; (a) Convert to: 형식 선택 (ComboBox)
    ; [튜닝필요] 콤보 컨트롤 ID 확인 후:
    ; ControlCommand($EXPORT_WIN, "", "[CLASS:ComboBox; INSTANCE:1]", "SelectString", $FORMAT)

    ; (b) Type of conversion: File 라디오 (기본 선택돼 있으면 생략)
    ; ControlClick($EXPORT_WIN, "", "[TEXT:File]")

    ; (c) Destination file: 저장 경로 입력 (8.3 파일명 안전)
    Local $fname = $OUT_DIR & "\CIRC" & StringFormat("%04d", $i) & ".csv"
    ; [튜닝필요] Destination file 에디트 컨트롤 ID:
    ; ControlSetText($EXPORT_WIN, "", "[CLASS:Edit; INSTANCE:2]", $fname)

    ; (d) Ok 로 확정
    ControlClick($EXPORT_WIN, "", "[TEXT:Ok]")

    ; 덮어쓰기 경고창이 뜨면 확인
    If WinExists("[TEXT:already exists]") Then ControlClick("[TEXT:already exists]", "", "[TEXT:Yes]")

    Sleep(600)
Next

FileWriteLine($OUT_DIR & "\_export_log.txt", @YEAR & "-" & @MON & "-" & @MDAY & " " & @HOUR & ":" & @MIN & "  export 완료 (" & $N & "개)")
; 이후 run_daily.bat 이 daily_report.py 로 엑셀 기입을 이어서 실행
