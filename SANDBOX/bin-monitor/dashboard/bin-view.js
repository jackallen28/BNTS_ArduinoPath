// Isometric timber enclosure with an independently hinged lid.
// The body stays opaque; the adjacent teal gauge visualises the fill reading.
let nextBinId = 0;

export function createBinView() {
  const id = `timber-bin-${++nextBinId}`;
  const root = document.createElement('div');
  root.className = 'bin timber-bin';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <svg class="bin-model" viewBox="0 0 480 650" xmlns="http://www.w3.org/2000/svg" focusable="false">
      <defs>
        <linearGradient id="${id}-front" x1="0" y1="0" x2="1" y2="0">
          <stop stop-color="#c8954c"/><stop offset=".35" stop-color="#e3b66d"/><stop offset=".7" stop-color="#d0a159"/><stop offset="1" stop-color="#bd8a43"/>
        </linearGradient>
        <linearGradient id="${id}-side" x1="0" y1="0" x2="1" y2="0">
          <stop stop-color="#b2813f"/><stop offset=".5" stop-color="#c89a52"/><stop offset="1" stop-color="#ad7e3b"/>
        </linearGradient>
        <linearGradient id="${id}-lid" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#e6bd7a"/><stop offset=".5" stop-color="#d5aa62"/><stop offset="1" stop-color="#c99850"/>
        </linearGradient>
        <linearGradient id="${id}-frame" x1="0" y1="0" x2="0" y2="1">
          <stop stop-color="#72736c"/><stop offset="1" stop-color="#494e4d"/>
        </linearGradient>
        <linearGradient id="${id}-inside" x1="0" y1="0" x2="0" y2="1">
          <stop stop-color="#342e22"/><stop offset="1" stop-color="#8b693b"/>
        </linearGradient>
        <pattern id="${id}-grain" width="35" height="250" patternUnits="userSpaceOnUse">
          <path d="M4 -10 C-3 30 11 65 4 110 S9 190 4 260 M18 -10 C25 25 9 65 18 110 S12 200 18 260 M28 -10 C18 30 37 70 28 115 S36 195 28 260" fill="none" stroke="#80521e" stroke-width="1.2" opacity=".10"/>
          <path d="M8 -10 C14 35 2 70 8 115 S3 200 8 260 M23 -10 C16 35 30 80 23 125 S29 200 23 260" fill="none" stroke="#fff0c3" stroke-width="2" opacity=".14"/>
        </pattern>
        <pattern id="${id}-lidgrain" width="200" height="22" patternUnits="userSpaceOnUse">
          <path d="M-10 5 C40 0 70 13 120 5 S180 9 210 5 M-10 15 C35 22 85 8 130 15 S180 11 210 15" fill="none" stroke="#865b2a" stroke-width=".8" opacity=".19"/>
        </pattern>
        <clipPath id="${id}-frontclip"><path d="M96 258 265 345 265 601 96 514Z"/></clipPath>
        <clipPath id="${id}-sideclip"><path d="M280 345 421 265 421 523 280 602Z"/></clipPath>
      </defs>

      <ellipse cx="265" cy="608" rx="176" ry="27" fill="#254852" opacity=".10"/>
      <path d="M87 245 272 340 272 617 87 522Z" fill="url(#${id}-front)" stroke="#7a603c" stroke-width="1.5"/>
      <path d="M272 340 430 250 430 528 272 617Z" fill="url(#${id}-side)" stroke="#745a35" stroke-width="1.5"/>
      <path d="M80 230H450V630H80Z" fill="url(#${id}-grain)" clip-path="url(#${id}-frontclip)"/>
      <path d="M80 230H450V630H80Z" fill="url(#${id}-grain)" clip-path="url(#${id}-sideclip)" opacity=".7"/>
      <path d="M97 266V509 M265 352V598" fill="none" stroke="#f2d7a0" opacity=".55"/>
      <path d="M280 352V599 M421 272V519" fill="none" stroke="#714f28" opacity=".35"/>
      <path d="M269 344 275 342 275 610 269 613Z" fill="#565950"/>

      <!-- Base surround. -->
      <path d="M80 518 272 616 438 522 438 539 272 634 80 535Z" fill="#414847" stroke="#343c3c" stroke-width="1.4"/>
      <path d="M80 518 88 514 272 608 430 519 438 522 272 616Z" fill="#7e8175"/>
      <path d="M272 616V633 M87 522V536 M430 528V542" stroke="#9b9c8d" opacity=".45"/>
      <path d="M94 534 110 542 110 549 94 541Z M404 551 419 543 419 550 404 558Z" fill="#353d3e"/>

      <!-- Opaque top rim and deep aperture, seen when the flap opens. -->
      <path d="M87 245 245 155 430 250 272 340Z" fill="url(#${id}-frame)" stroke="#363d3c" stroke-width="1.8"/>
      <path d="M107 245 204 190 367 274 270 329Z" fill="url(#${id}-inside)" stroke="#292e2d" stroke-width="2"/>
      <path d="M107 245 204 190 204 217 128 260Z" fill="#8f713e"/>
      <path d="M204 190 367 274 346 286 204 217Z" fill="#ad8649"/>
      <path d="M128 260 204 217 346 286 270 329Z" fill="#2e332e" opacity=".8"/>
      <path d="M87 245 272 340 430 250 430 263 272 354 87 258Z" fill="#4b514e" stroke="#363d3c" stroke-width="1.5"/>
      <path d="M90 247 272 340 427 252" fill="none" stroke="#b4b5a2" opacity=".4"/>

      <!-- Hinge pivots are fixed to the rear deck. -->
      <path d="M197 178 211 185 211 196 197 189Z M374 269 388 276 388 287 374 280Z" fill="#9b9d91" stroke="#3b4240"/>

      <!-- Micro servo and horn on the fixed rear deck. -->
      <g class="servo-assembly">
        <path d="M286 181 316 197 342 182 313 167Z" fill="#5e6b6c" stroke="#303d40" stroke-width="1.4"/>
        <path d="M286 181 316 197 316 219 286 203Z" fill="#4c5a58" stroke="#303d40" stroke-width="1.2"/>
        <path d="M316 197 342 182 342 204 316 219Z" fill="#2939b1" stroke="#152563" stroke-width="1.2"/>
        <path d="M296 179 318 190 334 181 312 170Z" fill="#3747d7" stroke="#192761"/>
        <path d="M296 179 318 190 318 213 296 202Z" fill="#2947c7" stroke="#162960"/>
        <path d="M301 180 317 188 328 182 312 174Z" fill="#1d2532"/>
        <path d="M306 180 315 184 321 181" stroke="#d8be6f" stroke-width="1.3" fill="none"/>
        <path d="M323 199 344 187 350 191 329 204Z" fill="#b9bcb0" stroke="#3f4944" stroke-width="1.3"/>
        <ellipse cx="346" cy="191" rx="3" ry="3.5" fill="#687169" stroke="#3c4640"/>
        <path d="M327 203 330 205 330 220 326 218Z" fill="#969e91" stroke="#3f4944"/>
      </g>

      <!-- The local x axis runs along the hinge; y runs to the free edge.
           Both affine matrices keep local (0,0) at the same physical hinge. -->
      <g class="lid">
        <path d="M0 0H200V150H0Z" fill="#555b54" stroke="#303a37" stroke-width="2" stroke-linejoin="round"/>
        <path d="M0 150H200V157H0Z" fill="#3d4741" stroke="#303a37" stroke-width="1"/>
        <rect x="12" y="12" width="176" height="126" rx="11" fill="url(#${id}-lid)" stroke="#3d443b" stroke-width="1.8"/>
        <rect x="13" y="13" width="174" height="124" rx="10" fill="url(#${id}-lidgrain)"/>
        <path d="M3 3H197 M3 3V147" fill="none" stroke="#c1c2ad" opacity=".55"/>
        <path d="M72 151H128V160H72Z" fill="#60685b" stroke="#343e35" stroke-width="1.3"/>
        <circle cx="82" cy="155" r="1.9" fill="#acaf98" stroke="#333e35" stroke-width=".8"/>
        <circle cx="118" cy="155" r="1.9" fill="#acaf98" stroke="#333e35" stroke-width=".8"/>
      </g>


    </svg>
    <div class="bin-level-gauge">
      <span class="gauge-title">FILL</span>
      <div class="gauge-track"><div class="fill"></div></div>
      <span class="gauge-zero">0</span><span class="gauge-full">100</span>
    </div>`;
  return root;
}
