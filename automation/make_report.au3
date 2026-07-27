; =====================================================================
;  make_report.au3  —  CSV → "측정값 표시" 엑셀  (파이썬 없이!)
; ---------------------------------------------------------------------
;  이미 깔린 AutoIt + Excel 만으로 동작한다. 파이썬 설치 불필요.
;    · AutoIt : CSV 를 읽어 '표시할 행'을 계산
;    · Excel  : CSV 를 열어 그 행을 노란색으로 칠하고 xlsx 로 저장
;
;  사용법:
;    · 이 파일(또는 make_report.bat) 에 CSV 를 마우스로 끌어다 놓기
;    · 인자 없이 실행하면 E:\bts_csv 폴더의 모든 CSV 처리
;
;  표시 규칙 (make_display_report.py 와 동일):
;    · CCA(방전전류>100A) : 크랭킹 방전 시작·5·10·30초 + 지구력방전 종료
;    · 수명(사이클≥2)     : N사이클마다 방전 종료행 (기본 5)
;    · 그 외 단일시험      : 첫 시험블록 시작 + 각 스텝 완료점
;    · 파일명에 J2801 있으면 건너뜀
; =====================================================================
#include <File.au3>
#include <Array.au3>

Global $CYC_INTERVAL = 5           ; 수명시험 표시 간격(사이클)
Global $YELLOW = 65535             ; Excel 노란색(BGR: RGB 255,255,0)
Global $FOLDER = "E:\bts_csv"

; ── 유틸 ─────────────────────────────────────────────────────────────
Func fld($line, $n0)               ; 0-based 필드
    Local $a = StringSplit($line, ",", 2)
    If $n0 >= 0 And $n0 <= UBound($a) - 1 Then Return StringStripWS($a[$n0], 3)
    Return ""
EndFunc

Func colIdx($hdrLine, $name)       ; 헤더에서 컬럼 위치(0-based)
    Local $a = StringSplit($hdrLine, ",", 2)
    For $i = 0 To UBound($a) - 1
        If StringStripWS($a[$i], 3) = $name Then Return $i
    Next
    Return -1
EndFunc

Func isDigits($s)
    Return StringRegExp($s, "^\d+$") = 1
EndFunc

; "HH:MM:SS.ff" → 초(실수).  없으면 -1
Func stepSec($s)
    $s = StringStripWS($s, 3)
    If $s = "" Then Return -1
    Local $frac = 0
    Local $dot = StringInStr($s, ".")
    If $dot > 0 Then
        Local $f = StringMid($s, $dot + 1)
        If isDigits($f) Then $frac = Number("0." & $f)
        $s = StringLeft($s, $dot - 1)
    EndIf
    Local $p = StringSplit($s, ":", 2)
    If UBound($p) < 3 Then Return -1
    Return Number($p[0]) * 3600 + Number($p[1]) * 60 + Number($p[2]) + $frac
EndFunc

Func colLetter($n)                 ; 1→A, 2→B ... (14→N)
    Local $s = ""
    While $n > 0
        Local $r = Mod($n - 1, 26)
        $s = Chr(65 + $r) & $s
        $n = Int(($n - 1) / 26)
    WEnd
    Return $s
EndFunc

; ── CSV 1개 → 표시할 '엑셀 행번호' 배열 반환 (+ 종류) ───────────────
Func computeHighlights($path, ByRef $kind, ByRef $lastCol)
    Local $txt = FileRead($path)
    Local $lines = StringSplit($txt, @CRLF, 1)
    If $lines[0] < 2 Then $lines = StringSplit($txt, @LF, 1)

    ; 데이터 헤더 줄 찾기 (Step,Status...)
    Local $hdr = 0
    For $i = 1 To $lines[0]
        If fld($lines[$i], 0) = "Step" And fld($lines[$i], 1) = "Status" Then
            $hdr = $i
            ExitLoop
        EndIf
    Next
    $kind = ""
    If $hdr = 0 Then Return 0

    Local $hdrLine = $lines[$hdr]
    Local $cStep = colIdx($hdrLine, "Step")
    Local $cStat = colIdx($hdrLine, "Status")
    Local $cSect = colIdx($hdrLine, "Step time")
    Local $cCur = colIdx($hdrLine, "Current")
    Local $cCyc = colIdx($hdrLine, "Cycle")
    Local $cAccu = colIdx($hdrLine, "AhAccu")
    $lastCol = colLetter(UBound(StringSplit($hdrLine, ",", 2)))

    ; 데이터 배열 만들기 (엑셀행번호, step, status, sec, cur, cyc, hasData)
    Local $N = $lines[0] - ($hdr + 1)
    If $N < 1 Then Return 0
    Local $ln[$N], $st[$N], $sa[$N], $sc[$N], $cu[$N], $cy[$N], $hd[$N]
    Local $m = 0
    Local $maxCyc = 0, $maxCur = 0
    For $i = $hdr + 2 To $lines[0]
        Local $L = $lines[$i]
        If StringStripWS($L, 3) = "" Then ContinueLoop
        $ln[$m] = $i                       ; 엑셀 행번호 = CSV 줄번호
        $st[$m] = fld($L, $cStep)
        $sa[$m] = fld($L, $cStat)
        $sc[$m] = stepSec(fld($L, $cSect))
        Local $c = fld($L, $cCur)
        If $c = "" Then
            $cu[$m] = ""
        Else
            $cu[$m] = Number($c)
        EndIf
        $cy[$m] = fld($L, $cCyc)
        $hd[$m] = (fld($L, $cAccu) <> "")
        If isDigits($cy[$m]) And Number($cy[$m]) > $maxCyc Then $maxCyc = Number($cy[$m])
        If $cu[$m] <> "" And Abs($cu[$m]) > $maxCur Then $maxCur = Abs($cu[$m])
        $m += 1
    Next
    If $m = 0 Then Return 0

    ; 블록 분할 (연속 같은 step) : [step, status, startIdx, endIdx]
    Local $bStep[$m], $bStat[$m], $bS[$m], $bE[$m], $nb = 0
    For $k = 0 To $m - 1
        If $nb > 0 And $bStep[$nb - 1] = $st[$k] Then
            $bE[$nb - 1] = $k
        Else
            $bStep[$nb] = $st[$k]
            $bStat[$nb] = $sa[$k]
            $bS[$nb] = $k
            $bE[$nb] = $k
            $nb += 1
        EndIf
    Next

    Local $hl[1] = [0]                       ; 결과: [0]=count
    ; ── CCA ──
    If $maxCur > 100 And $cSect >= 0 Then
        $kind = "CCA"
        Local $dchN = 0
        For $b = 0 To $nb - 1
            If $bStat[$b] <> "DCH" Then ContinueLoop
            Local $s = $bS[$b], $e = $bE[$b]
            If $dchN = 0 Then
                addHL($hl, $ln[$s])                       ; 방전 시작
                Local $secs[3] = [5, 10, 30]
                For $t = 0 To 2
                    Local $best = -1, $bd = -1
                    For $k = $s To $e
                        If Not $hd[$k] Or $sc[$k] < 0 Then ContinueLoop
                        Local $dd = Abs($sc[$k] - $secs[$t])
                        If $bd < 0 Or $dd <= $bd Then
                            $best = $k
                            $bd = $dd
                        EndIf
                    Next
                    If $best >= 0 And $bd <= 0.6 Then addHL($hl, $ln[$best])
                Next
                Local $ed = lastData($hd, $s, $e)
                If $ed >= 0 Then addHL($hl, $ln[$ed])
            Else
                Local $ed2 = lastData($hd, $s, $e)
                If $ed2 >= 0 Then addHL($hl, $ln[$ed2])
            EndIf
            $dchN += 1
        Next
        Return $hl
    EndIf

    ; ── 수명(사이클≥2) ──
    If $maxCyc >= 2 Then
        $kind = "cycle"
        ; 각 사이클의 마지막 DCH 행
        Local $maxc = $maxCyc
        Local $lastIdx[$maxc + 1]
        For $z = 0 To $maxc
            $lastIdx[$z] = -1
        Next
        For $k = 0 To $m - 1
            If $sa[$k] = "DCH" And isDigits($cy[$k]) Then $lastIdx[Number($cy[$k])] = $k
        Next
        For $c = 1 To $maxc
            If Mod($c, $CYC_INTERVAL) = 0 And $lastIdx[$c] >= 0 Then addHL($hl, $ln[$lastIdx[$c]])
        Next
        Return $hl
    EndIf

    ; ── 단일시험 ──
    $kind = "single"
    Local $lo = 0, $hi = $nb - 1
    While $lo <= $hi And $bStat[$lo] = "PAU"
        $lo += 1
    WEnd
    While $hi >= $lo And ($bStat[$hi] = "STO" Or $bStep[$hi] = "9999")
        $hi -= 1
    WEnd
    If $lo <= $hi Then
        addHL($hl, $ln[$bS[$lo]])                 ; 첫 시험블록 시작
        For $b = $lo To $hi
            addHL($hl, $ln[$bE[$b]])              ; 각 블록 끝
        Next
    EndIf
    Return $hl
EndFunc

; 블록 [s,e] 안에서 데이터 있는 마지막 행 idx (없으면 -1)
Func lastData(ByRef $hd, $s, $e)
    Local $f = -1
    For $k = $s To $e
        If $hd[$k] Then $f = $k
    Next
    Return $f
EndFunc

; 행번호를 결과배열에 추가 (중복 무시)
Func addHL(ByRef $hl, $row)
    For $i = 1 To $hl[0]
        If $hl[$i] = $row Then Return
    Next
    ReDim $hl[$hl[0] + 2]
    $hl[0] += 1
    $hl[$hl[0]] = $row
EndFunc

; ── Excel 로 CSV 열어 표시 후 xlsx 저장 ──────────────────────────────
Func makeReport($csv)
    Local $kind = "", $lastCol = "N"
    Local $hl = computeHighlights($csv, $kind, $lastCol)
    If Not IsArray($hl) Then Return SetError(1, 0, False)

    Local $drive, $dir, $fname, $ext
    _PathSplit($csv, $drive, $dir, $fname, $ext)
    Local $out = $drive & $dir & $fname & " - 표시.xlsx"

    Local $oExcel = ObjCreate("Excel.Application")
    If @error Or Not IsObj($oExcel) Then
        MsgBox(16, "Excel 필요", "Excel 이 설치되어 있어야 합니다." & @CRLF & "(엑셀로 CSV를 열어 표시합니다)")
        Return SetError(2, 0, False)
    EndIf
    $oExcel.Visible = False
    $oExcel.DisplayAlerts = False

    Local $oWb = $oExcel.Workbooks.Open($csv)
    Local $oWs = $oWb.Worksheets(1)
    For $i = 1 To $hl[0]
        $oWs.Range("A" & $hl[$i] & ":" & $lastCol & $hl[$i]).Interior.Color = $YELLOW
    Next
    FileDelete($out)
    $oWb.SaveAs($out, 51)          ; 51 = xlOpenXMLWorkbook (.xlsx)
    $oWb.Close(0)
    $oExcel.Quit
    $oExcel = 0
    Return $out
EndFunc

; ── 실행 ─────────────────────────────────────────────────────────────
Global $done = 0, $fail = 0

If $CmdLine[0] = 0 Then
    ; 인자 없음 → 폴더 전체
    Local $files = _FileListToArray($FOLDER, "*.csv", 1)
    If @error Then
        MsgBox(48, "안내", $FOLDER & " 에 CSV가 없습니다." & @CRLF & "또는 이 파일에 CSV를 끌어다 놓으세요.")
        Exit
    EndIf
    For $i = 1 To $files[0]
        If StringInStr($files[$i], "J2801") Then ContinueLoop
        If StringInStr($files[$i], " - 표시") Then ContinueLoop
        oneFile($FOLDER & "\" & $files[$i])
    Next
Else
    ; 끌어다 놓은 파일들
    For $i = 1 To $CmdLine[0]
        oneFile($CmdLine[$i])
    Next
EndIf

MsgBox(64, "완료", "표시 엑셀 생성 완료!" & @CRLF & "성공 " & $done & " / 실패 " & $fail & @CRLF & "(같은 폴더에 'ㅇㅇ - 표시.xlsx')")

Func oneFile($csv)
    If StringInStr($csv, "J2801") Then Return
    Local $out = makeReport($csv)
    If @error Or $out = False Then
        $fail += 1
    Else
        $done += 1
    EndIf
EndFunc
