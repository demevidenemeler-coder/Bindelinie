# Bindelinie

Rechner für Anzahl und Bandlänge der Umfangsbindungen an Produktcoils.
Läuft im Browser, lässt sich auf dem Handy installieren und funktioniert danach offline.

## Rechnung

- **Breite:** unbesäumt (B = N) zählt **Br**, besäumt (B = J) oder geteilt („1:1 (3)“) zählt **BrAus**.
- **Anzahl Bänder** aus der Werkstabelle (Dicke × Breite). Gilt für Hand- und Außenumreifung.
- **Außen-Ø** aus Gewicht des ganzen Bundes, Einsatzbreite (Br) und Innen-Ø, Stahldichte 7,85 kg/dm³.
  Teilen und Besäumen ändern den Außen-Ø nicht. Einsatzbreite leer = gleich Breite.
- **Wanddicke** = (Außen-Ø − Innen-Ø) / 2
- **Ohne Gewicht** = automatische Umreifung: Seitenansicht mit Längsbändern um den Mantel, keine Längenberechnung.
- **Mit Gewicht** = Handbindung: maßstäbliche Stirnansicht mit Bändern durchs Auge.
- Bemaßung jeweils über „Details anzeigen“.
- **Länge je Band** = 2 × (Wanddicke + Breite) + Zugabe, Zuschnitt auf 5 cm aufgerundet.

## Zettel fotografieren

Foto vom Ausdruck der Reihenfolge → Liste mit Ident, ID, Bänderzahl und Zuschnitt je Bund.
Die Texterkennung (Tesseract.js) läuft komplett auf dem Handy, auch offline. Das Foto verlässt das Gerät nicht.

- Gebraucht werden die Spalten **B, BrAus, Br, Di, Gew**; dazu **Lng** für die Gewichtsprobe und **IDA** für den Innen-Ø.
- **B (besäumt):** gelesen aus dem Buchstaben J/N und der grauen Hinterlegung der BrAus-Zelle.
  Nicht erkannt → orange, gerechnet wird dann mit Br (die breitere, also eher zu lang als zu kurz).
  Geteilte Bunde sind immer J; steht bei einem geteilten Bund N, wird die Zeile orange.
- **Gewichtsprobe:** Br × Di × Lng × 7,85 muss auf ±5 % zum Gewicht passen. Damit fallen falsch gelesene Ziffern auf.
- Farben: grün = Probe bestanden, gelb = ohne Probe (Lng fehlt oder ist abgeschnitten), orange = bitte prüfen.
- Antippen zeigt über jedem Wert den Ausschnitt aus dem Foto; Werte lassen sich dort korrigieren.

Tipps für den Ausdruck: Spalte Lng so breit, dass 4-stellige Längen ganz drauf sind (nicht „1.6…“);
Blatt gerade, ganz und scharf fotografieren.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Die App: Rechner und Liste |
| `scan.js` | Zettel-Erkennung (Tabelle finden, Zahlen lesen, prüfen) |
| `ocr/` | Tesseract.js 7.0.0 mit Englisch-Modell (Apache-2.0), lokal statt CDN |
| `manifest.webmanifest` | Name, Farben und Icons für die Installation |
| `sw.js` | Service Worker für den Offline-Betrieb |
| `icons/` | App-Icons |

## Auf GitHub Pages veröffentlichen

1. Neues Repository anlegen, alle Dateien hochladen (Ordnerstruktur beibehalten).
2. *Settings → Pages → Branch: `main`, Ordner `/ (root)`* → Speichern.
3. Nach ein bis zwei Minuten läuft die App unter `https://<benutzername>.github.io/<repo-name>/`.
4. Auf dem Handy im Chrome öffnen → Menü → *App installieren*.

## Update einspielen

Nach jeder Änderung an `index.html`, `scan.js` oder den Icons in `sw.js` die Zeile `const VERSION = "v8";` hochzählen (`v9`, `v10` …).
Sonst bekommen installierte Handys die neuen Icons oder Dateien nicht.
