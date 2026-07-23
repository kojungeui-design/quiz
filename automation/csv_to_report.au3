; =====================================================================
; CSV → 관리대장(요약 CSV)  — 파이썬 없이 AutoIt만으로
; E:\bts_csv 의 모든 CSV를 읽어, 회로당 1행 요약을 만들어
; _관리대장.csv 로 저장한다 (엑셀로 바로 열림).
; 파일명이 아니라 CSV 안의 Battery ID를 읽으므로 이름 틀려도 정확.
; =====================================================================
#include <File.au3>
#include <Array.au3>

Global $DIR = "E:\bts_csv"
Global $OUT = $DIR & "\_report.csv"      ; 영문 파일명 (한글 파일명은 저장 실패 가능)

; 요약 컬럼
Global $HEADER = "시료,회로,시험구간,프로그램,상태,경과(h),현재전압(V),충전용량(Ah),방전용량(Ah),사이클"

; CSV 한 줄에서 n번째 필드(1부터)
Func fld($line, $n)
    Local $a = StringSplit($line, ",", 2)   ; 0-based
    If $n - 1 <= UBound($a) - 1 Then Return $a[$n - 1]
    Return ""
EndFunc

; 헤더행에서 특정 컬럼명의 인덱스(1부터) 찾기
Func colIdx($hdrLine, $name)
    Local $a = StringSplit($hdrLine, ",", 2)
    For $i = 0 To UBound($a) - 1
        If StringStripWS($a[$i], 3) = $name Then Return $i + 1
    Next
    Return 0
EndFunc

Func num($s)
    $s = StringStripWS($s, 3)
    If $s = "" Then Return ""
    Return Number($s)
EndFunc

; CSV 1개 → 요약 1행
Func summarize($path)
    Local $txt = FileRead($path)
    Local $lines = StringSplit($txt, @CRLF, 1)
    If @error Then $lines = StringSplit($txt, @LF, 1)

    Local $batt = "", $circ = "", $sect = "", $prog = ""
    Local $hdrRow = 0, $col

    ; 메타 + 데이터 헤더 위치 찾기
    For $i = 1 To $lines[0]
        Local $L = $lines[$i]
        Local $k = StringStripWS(fld($L, 1), 3)
        If $i = 1 Then
            Local $m = StringRegExp($L, "Batt(\d+)", 1)
            If IsArray($m) Then $batt = "Batt" & $m[0]
            Local $m2 = StringRegExp($L, "Batt\d+,\s*([^,]+)", 1)
            If IsArray($m2) Then $sect = StringStripWS($m2[0], 3)
        ElseIf $k = "Program:" Then
            $prog = StringStripWS(fld($L, 2), 3)
        ElseIf $k = "Circuit:" Then
            $circ = StringStripWS(fld($L, 2), 3)
        ElseIf $k = "Step" And StringInStr($L, "Status") Then
            $hdrRow = $i
            ExitLoop
        EndIf
    Next
    If $hdrRow = 0 Then Return ""

    Local $cStatus = colIdx($lines[$hdrRow], "Status")
    Local $cVolt = colIdx($lines[$hdrRow], "Voltage")
    Local $cCur  = colIdx($lines[$hdrRow], "Current")
    Local $cCha  = colIdx($lines[$hdrRow], "AhCha")
    Local $cDch  = colIdx($lines[$hdrRow], "AhDch")
    Local $cCyc  = colIdx($lines[$hdrRow], "Cycle")
    Local $cPt   = colIdx($lines[$hdrRow], "Program time")

    Local $lastStatus = "", $lastV = "", $maxCha = 0, $maxDch = 0
    Local $maxCyc = 0, $lastPt = ""

    For $i = $hdrRow + 2 To $lines[0]
        Local $L = $lines[$i]
        If StringStripWS($L, 3) = "" Then ContinueLoop
        Local $st = StringStripWS(fld($L, $cStatus), 3)
        If $st = "" Then ContinueLoop
        $lastStatus = $st
        $lastV = fld($L, $cVolt)
        $lastPt = fld($L, $cPt)
        Local $ch = num(fld($L, $cCha))
        Local $dc = num(fld($L, $cDch))
        Local $cy = num(fld($L, $cCyc))
        If $ch <> "" And $ch > $maxCha Then $maxCha = $ch
        If $dc <> "" And $dc > $maxDch Then $maxDch = $dc
        If $cy <> "" And $cy > $maxCyc Then $maxCyc = $cy
    Next

    ; 유효 데이터 없는 파일은 건너뜀 (빈 줄 방지)
    If $lastStatus = "" Then Return ""

    ; 상태 한글화
    Local $stKo = $lastStatus
    If $lastStatus = "CHA" Then $stKo = "충전"
    If $lastStatus = "DCH" Then $stKo = "방전"
    If $lastStatus = "PAU" Then $stKo = "휴지"
    If $lastStatus = "STO" Then $stKo = "정지"

    ; 경과시간(h) = Program time 시:분:초 → 시간
    Local $ph = ""
    Local $pt = StringSplit($lastPt, ":", 2)
    If UBound($pt) >= 2 Then $ph = Round(Number($pt[0]) + Number($pt[1]) / 60, 1)

    Return $batt & "," & $circ & "," & $sect & "," & $prog & "," & $stKo & "," & _
           $ph & "," & StringStripWS($lastV, 3) & "," & Round($maxCha, 3) & "," & _
           Round($maxDch, 3) & "," & $maxCyc
EndFunc

; ── 실행 ──
Local $files = _FileListToArray($DIR, "*.csv", 1)
If @error Then
    MsgBox(48, "오류", $DIR & " 에 CSV가 없습니다.")
    Exit
EndIf

Local $out = $HEADER & @CRLF
Local $cnt = 0
For $i = 1 To $files[0]
    If $files[$i] = "_관리대장.csv" Then ContinueLoop
    Local $row = summarize($DIR & "\" & $files[$i])
    If $row <> "" Then
        $out &= $row & @CRLF
        $cnt += 1
    EndIf
Next

FileDelete($OUT)
; UTF-8 BOM 으로 저장 → 엑셀에서 한글 안 깨짐
Local $h = FileOpen($OUT, 2 + 128)   ; 2=쓰기, 128=UTF8(BOM)
If $h = -1 Then
    MsgBox(16, "저장 실패", "파일을 못 만듭니다: " & $OUT & @CRLF & "경로/권한 확인 필요")
    Exit
EndIf
FileWrite($h, $out)
FileClose($h)
MsgBox(64, "완료", $cnt & "개 회로 정리 완료!" & @CRLF & "생성됨: " & $OUT & @CRLF & "(폴더에서 _report.csv 를 엑셀로 열어보세요)")
