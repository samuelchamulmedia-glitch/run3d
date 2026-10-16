# Compact and responsive editor

The page is a bounded viewport editor, rather than a long stack of controllers. Desktop uses preview plus a separate control column. Mobile uses preview/playback above a six-section tab row and scrollable controller area. Warnings are collapsible; errors remain visible. All panels remain mounted so switching sections does not discard settings. Tabs expose tab/tabpanel roles, aria-selected/controls relationships and left/right/Home/End keyboard navigation. Enlarge preview keeps the canvas and playback controls mounted while the other controls are inert; Escape exits.

Checked in the in-app browser at desktop width, 390×844 and 320×568, including a portrait video. At 320×568 the document matched viewport width and height, the timeline stayed within the viewport, and only the selected panel was visible. Mobile control tabs were subsequently reduced to one row to give more room to the selected controls. Physical-device encoding remains unverified.

GitHub deployment uses the checked-in Actions workflow and the existing relative Vite asset base. Pages hosts the public app shell. All imports and rendering stay on the visitor's device. No health data or precise user GPS coordinates are part of the source package. Publishing was not performed.
