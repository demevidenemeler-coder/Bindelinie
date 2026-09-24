# Bindelinie

Rechner für Anzahl und Bandlänge der Umfangsbindungen an Produktcoils.
Läuft im Browser, lässt sich auf dem Handy installieren und funktioniert danach offline.

## Rechnung

- **Anzahl Bänder** aus der Werkstabelle (Dicke × Breite).
- **Außen-Ø** aus Gewicht, Breite und Innen-Ø, Stahldichte 7,85 kg/dm³.
- **Wanddicke** = (Außen-Ø − Innen-Ø) / 2
- **Ohne Gewicht** = automatische Umreifung: Seitenansicht mit Längsbändern um den Mantel, keine Längenberechnung.
- **Mit Gewicht** = Handbindung: maßstäbliche Stirnansicht mit Bändern durchs Auge.
- Bemaßung jeweils über „Details anzeigen“.
- **Länge je Band** = 2 × (Wanddicke + Breite) + Zugabe, Zuschnitt auf 5 cm aufgerundet.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Die komplette App |
| `manifest.webmanifest` | Name, Farben und Icons für die Installation |
| `sw.js` | Service Worker für den Offline-Betrieb |
| `icons/` | App-Icons |

## Auf GitHub Pages veröffentlichen

1. Neues Repository anlegen, alle Dateien hochladen (Ordnerstruktur beibehalten).
2. *Settings → Pages → Branch: `main`, Ordner `/ (root)`* → Speichern.
3. Nach ein bis zwei Minuten läuft die App unter `https://<benutzername>.github.io/<repo-name>/`.
4. Auf dem Handy im Chrome öffnen → Menü → *App installieren*.

## Update einspielen

Nach jeder Änderung in `sw.js` die Zeile `const VERSION = "v1";` hochzählen (`v2`, `v3` …).
Sonst bekommen installierte Handys die neuen Icons oder Dateien nicht.
