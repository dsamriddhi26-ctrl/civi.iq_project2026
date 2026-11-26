/**
 * Civ.IQ — "Civic Spotter" Interactive Animated Game
 *
 * Features:
 * - 3 distinct animated SVG neighborhood scenes (rotates on every open/replay)
 * - Movable/pannable & zoomable canvas (drag to explore, zoom +/- , reset view)
 * - 6 civic-sense & municipal issues per scene (potholes, broken streetlights,
 *   balcony littering, overflowing bins, traffic rule violations, pollution, etc.)
 * - Countdown timer, difficulty modes, combo streak multiplier, wrong-click penalty,
 *   Hint Radar, Web Audio sound effects (with mute), and Best Score / Civic Rank.
 */

(function () {
  'use strict';

  const SCENE_W = 1300;
  const SCENE_H = 760;

  // ─── Web Audio Synth (zero external audio files) ──────────────────────────

  let audioCtx = null;
  function playTone(type, muted) {
    if (muted) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'hit') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.14);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.23);
      } else if (type === 'miss') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(190, now);
        osc.frequency.linearRampToValueAtTime(130, now + 0.16);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.19);
      } else if (type === 'win') {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
          const o = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          o.type = 'sine';
          o.connect(g);
          g.connect(audioCtx.destination);
          o.frequency.setValueAtTime(freq, now + i * 0.09);
          g.gain.setValueAtTime(0.12, now + i * 0.09);
          g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.28);
          o.start(now + i * 0.09);
          o.stop(now + i * 0.09 + 0.29);
        });
      }
    } catch {
      // Ignore audio errors if blocked by browser autoplay policy
    }
  }

  // ─── 3 Distinct Animated Scenes (6 issues each) ───────────────────────────

  const SCENES = [
    {
      id: 'market_street',
      title: 'Busy Market Street & Apartments',
      subtitle: 'Pan across the street, balconies, and traffic lanes to spot 6 civic issues!',
      skyTop: '#cbe6ef',
      skyBottom: '#f7f3dc',
      issues: [
        {
          id: 'balcony_litter',
          title: 'Throwing Waste from Balcony',
          dept: 'Sanitation',
          tip: 'Tossing garbage bags from balconies creates street hazards. Always use segregated household bins.',
          x: 245, y: 245, r: 58
        },
        {
          id: 'broken_streetlight',
          title: 'Damaged & Flickering Streetlight',
          dept: 'Street Lighting',
          tip: 'Broken streetlights create dark blind spots at night. Report damaged poles to Street Lighting.',
          x: 522, y: 270, r: 55
        },
        {
          id: 'overflowing_bin',
          title: 'Waste Scattered Outside Dustbin',
          dept: 'Sanitation',
          tip: 'Trash piled around a bin attracts pests and blocks footpaths. Keep lids closed and report full bins.',
          x: 350, y: 505, r: 62
        },
        {
          id: 'deep_pothole',
          title: 'Deep Road Pothole',
          dept: 'Roads & Infrastructure',
          tip: 'Unrepaired potholes damage vehicles and cause accidents, especially during rain.',
          x: 695, y: 595, r: 62
        },
        {
          id: 'traffic_jump',
          title: 'Breaking Traffic Rule (Red Light & Divider)',
          dept: 'General Services',
          tip: 'Jumping red signals and crossing dividers puts pedestrians and riders at grave risk.',
          x: 945, y: 495, r: 64
        },
        {
          id: 'truck_pollution',
          title: 'Heavy Vehicle Smoke Pollution',
          dept: 'General Services',
          tip: 'Unmaintained engines emit toxic black exhaust. Regular PUC checks keep city air breathable.',
          x: 1120, y: 405, r: 64
        }
      ],
      renderSvg() {
        return `
          <defs>
            <linearGradient id="mSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#b7dce9"/><stop offset="100%" stop-color="#f9f1d5"/>
            </linearGradient>
          </defs>
          <rect width="${SCENE_W}" height="${SCENE_H}" fill="url(#mSky)"/>
          <!-- Sun & drifting clouds -->
          <circle cx="1140" cy="95" r="46" fill="#f4b426"/>
          <g class="game-anim-cloud">
            <ellipse cx="220" cy="85" rx="68" ry="22" fill="#fff" opacity="0.9"/>
            <ellipse cx="640" cy="70" rx="55" ry="18" fill="#fff" opacity="0.85"/>
          </g>
          <!-- Distant skyline -->
          <rect x="40" y="160" width="90" height="270" fill="#9fb9b2"/>
          <rect x="610" y="140" width="110" height="290" fill="#8aa8a0"/>
          <rect x="740" y="190" width="95" height="240" fill="#a5bfb8"/>
          <!-- Apartment building with balcony -->
          <rect x="115" y="120" width="250" height="330" rx="6" fill="#e8c391" stroke="#8d6e47" stroke-width="3"/>
          <rect x="115" y="105" width="250" height="20" fill="#8d4e2a"/>
          <!-- Windows -->
          <rect x="145" y="155" width="46" height="52" fill="#5e8c9e"/><rect x="295" y="155" width="46" height="52" fill="#5e8c9e"/>
          <rect x="145" y="295" width="46" height="52" fill="#5e8c9e"/><rect x="295" y="295" width="46" height="52" fill="#5e8c9e"/>
          <!-- Shopfront -->
          <rect x="430" y="230" width="170" height="220" rx="4" fill="#d98a5f" stroke="#7c4427" stroke-width="3"/>
          <rect x="455" y="340" width="120" height="110" fill="#fff3e0"/>
          <path d="M425 320 L605 320 L595 345 L435 345 Z" fill="#14533c"/>
          <!-- Sidewalk & Road -->
          <rect x="0" y="450" width="${SCENE_W}" height="75" fill="#d5dbd5"/>
          <rect x="0" y="525" width="${SCENE_W}" height="235" fill="#454d50"/>
          <!-- Dashed road divider -->
          <line x1="0" y1="635" x2="${SCENE_W}" y2="635" stroke="#f4b426" stroke-width="6" stroke-dasharray="36 28"/>
          <!-- Tree (swaying) -->
          <g class="game-anim-sway" style="transform-origin: 835px 450px">
            <rect x="825" y="345" width="18" height="105" fill="#6d4c41"/>
            <circle cx="834" cy="320" r="52" fill="#2d7a53"/>
            <circle cx="805" cy="340" r="34" fill="#1e6b4a"/>
          </g>

          <!-- ISSUE 1: Balcony Littering (animated falling bag) -->
          <g class="game-issue-target" data-issue-id="balcony_litter">
            <rect x="195" y="215" width="95" height="55" fill="#607d8b" opacity="0.25"/>
            <rect x="195" y="235" width="95" height="35" fill="none" stroke="#37474f" stroke-width="5"/>
            <!-- Person on balcony -->
            <circle cx="238" cy="200" r="14" fill="#d99b72"/>
            <rect x="225" y="214" width="26" height="34" rx="5" fill="#c0392b"/>
            <line x1="251" y1="222" x2="274" y2="232" stroke="#d99b72" stroke-width="7" stroke-linecap="round"/>
            <!-- Falling garbage bag -->
            <g class="game-anim-drop">
              <path d="M270 245 Q286 245 288 268 Q272 276 260 266 Z" fill="#2c3e50"/>
              <path d="M273 240 L277 247" stroke="#f4b426" stroke-width="3"/>
            </g>
          </g>

          <!-- ISSUE 2: Broken Flickering Streetlight -->
          <g class="game-issue-target" data-issue-id="broken_streetlight">
            <path d="M510 450 L510 235 L542 225" fill="none" stroke="#37474f" stroke-width="10" stroke-linecap="round"/>
            <g class="game-anim-flicker" style="transform-origin: 542px 228px">
              <ellipse cx="545" cy="235" rx="18" ry="9" fill="#f4b426"/>
              <path d="M530 250 L560 250 L545 275 Z" fill="#f9d45c" opacity="0.55"/>
              <path d="M540 218 L552 206 M556 226 L568 220" stroke="#e74c3c" stroke-width="3"/>
            </g>
          </g>

          <!-- ISSUE 3: Overflowing Dustbin & Scattered Trash -->
          <g class="game-issue-target" data-issue-id="overflowing_bin">
            <rect x="315" y="455" width="54" height="65" rx="5" fill="#1e8449"/>
            <rect x="310" y="446" width="64" height="11" rx="3" fill="#14533c" transform="rotate(-14 315 450)"/>
            <!-- Overflowing garbage & flies -->
            <circle cx="342" cy="448" r="14" fill="#424242"/>
            <circle cx="358" cy="452" r="10" fill="#8d6e63"/>
            <ellipse cx="298" cy="516" rx="16" ry="9" fill="#37474f"/>
            <rect x="376" y="508" width="18" height="10" rx="2" fill="#e67e22" transform="rotate(15 376 508)"/>
            <circle cx="386" cy="495" r="8" fill="#bdc3c7"/>
            <g class="game-anim-float">
              <circle cx="332" cy="426" r="2.5" fill="#212121"/>
              <circle cx="354" cy="420" r="2.5" fill="#212121"/>
            </g>
          </g>

          <!-- ISSUE 4: Deep Pothole -->
          <g class="game-issue-target" data-issue-id="deep_pothole">
            <ellipse cx="695" cy="595" rx="54" ry="22" fill="#1c2224" stroke="#616a6b" stroke-width="4"/>
            <ellipse cx="695" cy="598" rx="36" ry="12" fill="#101415"/>
            <path d="M645 592 L660 584 M738 602 L752 608" stroke="#7f8c8d" stroke-width="3"/>
            <!-- Knocked over warning cone -->
            <polygon points="755,580 785,592 758,602" fill="#e67e22"/>
          </g>

          <!-- ISSUE 5: Motorcyclist Jumping Red Light -->
          <g class="game-issue-target" data-issue-id="traffic_jump">
            <!-- Traffic signal showing RED -->
            <rect x="985" y="300" width="10" height="155" fill="#263238"/>
            <rect x="972" y="255" width="36" height="75" rx="6" fill="#1c2529"/>
            <circle cx="990" cy="274" r="9" fill="#e74c3c"/>
            <circle cx="990" cy="296" r="8" fill="#455a64"/>
            <circle cx="990" cy="316" r="8" fill="#455a64"/>
            <!-- Speeding bike crossing red line -->
            <g class="game-anim-shake">
              <circle cx="905" cy="545" r="20" fill="none" stroke="#1c2224" stroke-width="7"/>
              <circle cx="970" cy="545" r="20" fill="none" stroke="#1c2224" stroke-width="7"/>
              <path d="M905 545 L932 518 L964 522 L970 545" fill="none" stroke="#c0392b" stroke-width="8" stroke-linecap="round"/>
              <!-- Rider without helmet -->
              <circle cx="936" cy="484" r="12" fill="#d99b72"/>
              <rect x="924" y="496" width="22" height="28" rx="5" fill="#2980b9"/>
              <line x1="862" y1="532" x2="885" y2="532" stroke="#f4b426" stroke-width="3"/>
              <line x1="854" y1="544" x2="880" y2="544" stroke="#f4b426" stroke-width="3"/>
            </g>
          </g>

          <!-- ISSUE 6: Polluting Truck Exhaust -->
          <g class="game-issue-target" data-issue-id="truck_pollution">
            <rect x="1085" y="455" width="145" height="82" rx="8" fill="#d35400"/>
            <rect x="1040" y="485" width="50" height="52" rx="6" fill="#e67e22"/>
            <rect x="1048" y="494" width="28" height="22" rx="3" fill="#d6eaf8"/>
            <circle cx="1068" cy="542" r="18" fill="#1c2224"/><circle cx="1195" cy="542" r="18" fill="#1c2224"/>
            <!-- Animated smoke puffs -->
            <g class="game-anim-smoke">
              <circle cx="1238" cy="442" r="16" fill="#424242" opacity="0.8"/>
              <circle cx="1256" cy="414" r="22" fill="#616161" opacity="0.7"/>
              <circle cx="1272" cy="382" r="26" fill="#757575" opacity="0.55"/>
            </g>
          </g>
        `;
      }
    },

    {
      id: 'park_school',
      title: 'Neighborhood Park & School Zone',
      subtitle: 'Explore the park walkway, school gate, and green space to find 6 issues!',
      skyTop: '#bce3d8',
      skyBottom: '#eaf5ef',
      issues: [
        {
          id: 'spitting_litter',
          title: 'Spitting & Littering on Footpath',
          dept: 'Sanitation',
          tip: 'Spitting and littering in public walkways spreads disease and ruins shared spaces.',
          x: 245, y: 500, r: 62
        },
        {
          id: 'stray_dog_trash',
          title: 'Stray Dog Scavenging Open Waste',
          dept: 'Animal Control',
          tip: 'Uncollected garbage bags attract stray animals and create public health risks.',
          x: 470, y: 520, r: 60
        },
        {
          id: 'broken_bench',
          title: 'Broken Park Bench & Bottles',
          dept: 'General Services',
          tip: 'Damaged benches and broken glass in parks endanger children and seniors.',
          x: 680, y: 410, r: 62
        },
        {
          id: 'water_leak',
          title: 'Burst Pipe & Waterlogging',
          dept: 'Water & Drainage',
          tip: 'Leaking pipes waste clean water and cause slippery, mosquito-breeding puddles.',
          x: 865, y: 560, r: 64
        },
        {
          id: 'bent_park_light',
          title: 'Damaged Park Lamp Post',
          dept: 'Street Lighting',
          tip: 'Bent or unlit park lamps make evening walks unsafe.',
          x: 1020, y: 270, r: 58
        },
        {
          id: 'footpath_scooter',
          title: 'Riding Scooter on Pedestrian Footpath',
          dept: 'General Services',
          tip: 'Driving two-wheelers on pedestrian footpaths near schools endangers children.',
          x: 1145, y: 495, r: 64
        }
      ],
      renderSvg() {
        return `
          <defs>
            <linearGradient id="pSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#b8dfd5"/><stop offset="100%" stop-color="#f2f9f5"/>
            </linearGradient>
          </defs>
          <rect width="${SCENE_W}" height="${SCENE_H}" fill="url(#pSky)"/>
          <circle cx="170" cy="95" r="42" fill="#f4b426"/>
          <g class="game-anim-cloud">
            <ellipse cx="420" cy="80" rx="64" ry="20" fill="#fff" opacity="0.9"/>
            <ellipse cx="920" cy="65" rx="70" ry="22" fill="#fff" opacity="0.88"/>
          </g>
          <!-- School Building -->
          <rect x="65" y="165" width="310" height="215" rx="6" fill="#f5cb86" stroke="#a66e2e" stroke-width="3"/>
          <polygon points="50,165 220,95 390,165" fill="#b04a2e"/>
          <rect x="175" y="280" width="90" height="100" fill="#5d4037"/>
          <rect x="95" y="210" width="52" height="48" fill="#d6eaf8"/><rect x="290" y="210" width="52" height="48" fill="#d6eaf8"/>
          <rect x="165" y="160" width="110" height="28" rx="4" fill="#14533c"/>
          <text x="220" y="179" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">PUBLIC SCHOOL</text>
          <!-- Park grass -->
          <rect x="0" y="380" width="${SCENE_W}" height="150" fill="#58a368"/>
          <!-- Park trees -->
          <g class="game-anim-sway" style="transform-origin: 540px 380px">
            <rect x="532" y="275" width="16" height="105" fill="#6d4c41"/>
            <circle cx="540" cy="245" r="56" fill="#1e6b4a"/>
          </g>
          <g class="game-anim-sway" style="transform-origin: 840px 380px">
            <rect x="832" y="285" width="16" height="95" fill="#6d4c41"/>
            <circle cx="840" cy="255" r="50" fill="#2d7a53"/>
          </g>
          <!-- Footpath & Road -->
          <rect x="0" y="510" width="${SCENE_W}" height="95" fill="#e0e3dc"/>
          <rect x="0" y="605" width="${SCENE_W}" height="155" fill="#4a5255"/>
          <line x1="0" y1="680" x2="${SCENE_W}" y2="680" stroke="#fff" stroke-width="5" stroke-dasharray="30 24"/>

          <!-- ISSUE 1: Spitting / Littering Person (inspired by uploaded image) -->
          <g class="game-issue-target" data-issue-id="spitting_litter">
            <circle cx="220" cy="452" r="16" fill="#d99b72"/>
            <rect x="204" y="468" width="32" height="44" rx="6" fill="#e67e22"/>
            <rect x="208" y="512" width="10" height="34" fill="#2c3e50"/><rect x="222" y="512" width="10" height="34" fill="#2c3e50"/>
            <!-- Red spit / wrapper on footpath -->
            <path d="M236 458 Q254 468 258 492" fill="none" stroke="#c0392b" stroke-width="4" stroke-linecap="round"/>
            <ellipse cx="262" cy="528" rx="18" ry="7" fill="#c0392b" opacity="0.8"/>
          </g>

          <!-- ISSUE 2: Stray Dog Scavenging Trash beside Empty Bin -->
          <g class="game-issue-target" data-issue-id="stray_dog_trash">
            <rect x="405" y="458" width="42" height="58" rx="4" fill="#1e8449"/>
            <text x="426" y="492" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold">BIN</text>
            <!-- Scattered bags -->
            <circle cx="468" cy="528" r="15" fill="#37474f"/>
            <circle cx="488" cy="534" r="11" fill="#8d6e63"/>
            <!-- Stray Dog -->
            <g class="game-anim-float">
              <ellipse cx="515" cy="514" rx="22" ry="12" fill="#a67c52"/>
              <circle cx="493" cy="505" r="10" fill="#a67c52"/>
              <line x1="502" y1="524" x2="502" y2="540" stroke="#8d6e47" stroke-width="5"/>
              <line x1="526" y1="524" x2="526" y2="540" stroke="#8d6e47" stroke-width="5"/>
            </g>
          </g>

          <!-- ISSUE 3: Broken Park Bench & Scattered Bottles -->
          <g class="game-issue-target" data-issue-id="broken_bench">
            <rect x="630" y="395" width="95" height="12" rx="2" fill="#8d4e2a" transform="rotate(-10 630 395)"/>
            <rect x="635" y="416" width="90" height="10" rx="2" fill="#6d4c41"/>
            <rect x="642" y="426" width="8" height="22" fill="#37474f"/>
            <rect x="708" y="426" width="8" height="22" fill="#37474f" transform="rotate(20 708 426)"/>
            <rect x="665" y="445" width="16" height="7" rx="2" fill="#27ae60"/>
            <rect x="692" y="448" width="16" height="7" rx="2" fill="#e74c3c"/>
          </g>

          <!-- ISSUE 4: Leaking Water Pipe / Puddle -->
          <g class="game-issue-target" data-issue-id="water_leak">
            <ellipse cx="865" cy="572" rx="58" ry="20" fill="#2980b9" opacity="0.7"/>
            <ellipse cx="865" cy="572" rx="34" ry="10" fill="#5dade2" opacity="0.8"/>
            <rect x="842" y="510" width="18" height="36" fill="#7f8c8d"/>
            <g class="game-anim-drop">
              <path d="M858 530 Q875 538 872 558" fill="none" stroke="#3498db" stroke-width="5" stroke-linecap="round"/>
            </g>
          </g>

          <!-- ISSUE 5: Damaged / Bent Park Lamp Post -->
          <g class="game-issue-target" data-issue-id="bent_park_light">
            <path d="M1010 490 L1010 315 L1035 235" fill="none" stroke="#37474f" stroke-width="9" stroke-linecap="round"/>
            <g class="game-anim-flicker">
              <polygon points="1024,230 1052,238 1038,256" fill="#7f8c8d"/>
              <path d="M1038 220 L1052 210" stroke="#e74c3c" stroke-width="3"/>
            </g>
          </g>

          <!-- ISSUE 6: Scooter Riding on Pedestrian Footpath -->
          <g class="game-issue-target" data-issue-id="footpath_scooter">
            <!-- Bent school sign -->
            <line x1="1225" y1="510" x2="1238" y2="410" stroke="#455a64" stroke-width="6"/>
            <polygon points="1238,370 1265,412 1212,412" fill="#f4b426" stroke="#c0392b" stroke-width="3"/>
            <!-- Scooter on footpath -->
            <g class="game-anim-shake">
              <circle cx="1115" cy="538" r="16" fill="#1c2224"/>
              <circle cx="1172" cy="538" r="16" fill="#1c2224"/>
              <path d="M1115 538 L1138 518 L1166 518 L1172 538" fill="none" stroke="#2980b9" stroke-width="7"/>
              <circle cx="1142" cy="485" r="11" fill="#d99b72"/>
              <rect x="1132" y="496" width="20" height="24" rx="4" fill="#8e44ad"/>
            </g>
          </g>
        `;
      }
    },

    {
      id: 'highway_bus_stop',
      title: 'Highway Junction & Bus Stop',
      subtitle: 'Check the crosswalk, road divider, bus stop, and storm drain for 6 issues!',
      skyTop: '#d7e8ea',
      skyBottom: '#fdf3dc',
      issues: [
        {
          id: 'zebra_parking',
          title: 'Car Parked on Zebra Crossing',
          dept: 'General Services',
          tip: 'Blocking zebra crossings forces pedestrians into live traffic lanes.',
          x: 265, y: 560, r: 65
        },
        {
          id: 'car_bottle_toss',
          title: 'Throwing Waste from Moving Car',
          dept: 'Sanitation',
          tip: 'Littering from vehicle windows clutters highways and clogs storm drains.',
          x: 520, y: 495, r: 62
        },
        {
          id: 'broken_divider',
          title: 'Cracked & Broken Road Divider',
          dept: 'Roads & Infrastructure',
          tip: 'Damaged dividers fail to separate oncoming traffic and create debris.',
          x: 720, y: 635, r: 62
        },
        {
          id: 'sewage_drain',
          title: 'Burst Storm Drain / Sewage Overflow',
          dept: 'Water & Drainage',
          tip: 'Blocked or overflowing drains flood streets and spread waterborne illnesses.',
          x: 895, y: 525, r: 62
        },
        {
          id: 'bus_stop_bin',
          title: 'Overflowing Bus-Stop Dustbin',
          dept: 'Sanitation',
          tip: 'High-traffic bus stops need timely waste pickup so plastic does not blow onto roads.',
          x: 1050, y: 430, r: 60
        },
        {
          id: 'bus_smoke',
          title: 'Toxic Exhaust & Roadside Smoke',
          dept: 'General Services',
          tip: 'Heavy diesel smoke at bus stops directly harms waiting commuters.',
          x: 1185, y: 365, r: 64
        }
      ],
      renderSvg() {
        return `
          <defs>
            <linearGradient id="hSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#c4dde0"/><stop offset="100%" stop-color="#faf0d7"/>
            </linearGradient>
          </defs>
          <rect width="${SCENE_W}" height="${SCENE_H}" fill="url(#hSky)"/>
          <circle cx="1090" cy="90" r="40" fill="#f4b426"/>
          <g class="game-anim-cloud">
            <ellipse cx="280" cy="75" rx="65" ry="20" fill="#fff" opacity="0.88"/>
            <ellipse cx="760" cy="90" rx="58" ry="18" fill="#fff" opacity="0.85"/>
          </g>
          <!-- City backdrop -->
          <rect x="70" y="150" width="120" height="270" fill="#89a8a0"/>
          <rect x="210" y="180" width="100" height="240" fill="#a2bdb6"/>
          <rect x="330" y="135" width="130" height="285" fill="#6f9288"/>
          <!-- Bus Stop Shelter -->
          <rect x="935" y="275" width="190" height="145" fill="#e8f3ee" stroke="#14533c" stroke-width="5"/>
          <rect x="920" y="260" width="220" height="22" rx="4" fill="#14533c"/>
          <text x="1030" y="276" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold">BUS STOP</text>
          <!-- Sidewalk & Highway -->
          <rect x="0" y="420" width="${SCENE_W}" height="80" fill="#d5dbd5"/>
          <rect x="0" y="500" width="${SCENE_W}" height="260" fill="#3f474a"/>
          <!-- Zebra Crossing -->
          <g fill="#fff" opacity="0.92">
            <rect x="190" y="512" width="140" height="16"/><rect x="190" y="544" width="140" height="16"/>
            <rect x="190" y="576" width="140" height="16"/><rect x="190" y="608" width="140" height="16"/>
            <rect x="190" y="640" width="140" height="16"/>
          </g>
          <!-- Concrete Road Divider -->
          <rect x="380" y="622" width="280" height="26" rx="4" fill="#bdc3c7" stroke="#7f8c8d" stroke-width="2"/>
          <rect x="790" y="622" width="460" height="26" rx="4" fill="#bdc3c7" stroke="#7f8c8d" stroke-width="2"/>

          <!-- ISSUE 1: Car Parked on Zebra Crossing -->
          <g class="game-issue-target" data-issue-id="zebra_parking">
            <rect x="195" y="535" width="135" height="52" rx="10" fill="#2980b9"/>
            <rect x="218" y="515" width="84" height="26" rx="6" fill="#5dade2"/>
            <circle cx="222" cy="590" r="14" fill="#1c2224"/><circle cx="304" cy="590" r="14" fill="#1c2224"/>
            <circle cx="326" cy="548" r="6" fill="#f4b426" class="game-anim-flicker"/>
          </g>

          <!-- ISSUE 2: Throwing Bottle from Moving Car -->
          <g class="game-issue-target" data-issue-id="car_bottle_toss">
            <rect x="440" y="505" width="135" height="48" rx="9" fill="#c0392b"/>
            <rect x="466" y="486" width="76" height="24" rx="5" fill="#f5b7b1"/>
            <circle cx="468" cy="555" r="14" fill="#1c2224"/><circle cx="546" cy="555" r="14" fill="#1c2224"/>
            <line x1="518" y1="494" x2="538" y2="482" stroke="#d99b72" stroke-width="6" stroke-linecap="round"/>
            <g class="game-anim-drop">
              <rect x="542" y="476" width="12" height="22" rx="3" fill="#3498db"/>
            </g>
          </g>

          <!-- ISSUE 3: Broken Road Divider -->
          <g class="game-issue-target" data-issue-id="broken_divider">
            <polygon points="665,622 710,630 695,648 660,648" fill="#95a5a6"/>
            <polygon points="735,634 785,622 788,648 742,648" fill="#7f8c8d"/>
            <circle cx="718" cy="645" r="8" fill="#bdc3c7"/>
            <circle cx="732" cy="638" r="6" fill="#95a5a6"/>
          </g>

          <!-- ISSUE 4: Burst Storm Drain / Sewage Overflow -->
          <g class="game-issue-target" data-issue-id="sewage_drain">
            <rect x="865" y="492" width="56" height="16" rx="2" fill="#2c3e50"/>
            <ellipse cx="895" cy="532" rx="52" ry="18" fill="#6d4c41" opacity="0.82"/>
            <g class="game-anim-float">
              <circle cx="885" cy="522" r="5" fill="#a1887f"/>
              <circle cx="908" cy="528" r="6" fill="#a1887f"/>
            </g>
          </g>

          <!-- ISSUE 5: Overflowing Bus-Stop Dustbin -->
          <g class="game-issue-target" data-issue-id="bus_stop_bin">
            <rect x="1028" y="418" width="44" height="58" rx="4" fill="#1e8449"/>
            <circle cx="1050" cy="414" r="14" fill="#424242"/>
            <rect x="1076" y="465" width="16" height="9" fill="#f4b426"/>
            <ellipse cx="1008" cy="472" rx="14" ry="7" fill="#37474f"/>
          </g>

          <!-- ISSUE 6: Heavy Smoke from Roadside Diesel Bus -->
          <g class="game-issue-target" data-issue-id="bus_smoke">
            <rect x="1115" y="395" width="175" height="90" rx="8" fill="#e69d17"/>
            <rect x="1128" y="410" width="38" height="28" fill="#d6eaf8"/><rect x="1175" y="410" width="38" height="28" fill="#d6eaf8"/>
            <circle cx="1152" cy="488" r="16" fill="#1c2224"/><circle cx="1256" cy="488" r="16" fill="#1c2224"/>
            <g class="game-anim-smoke">
              <circle cx="1102" cy="395" r="18" fill="#424242" opacity="0.8"/>
              <circle cx="1125" cy="365" r="24" fill="#616161" opacity="0.68"/>
              <circle cx="1148" cy="332" r="28" fill="#757575" opacity="0.5"/>
            </g>
          </g>
        `;
      }
    }
  ];

  // ─── Game State & Rank Helpers ────────────────────────────────────────────

  function getCivicRank(bestScore) {
    if (bestScore >= 1200) return '🏆 Dream City Champion';
    if (bestScore >= 800) return '🛡️ Street Guardian';
    if (bestScore >= 400) return '👀 Neighborhood Watch';
    return '🌱 Civic Rookie';
  }

  function pickNextSceneIndex() {
    const last = parseInt(localStorage.getItem('civiq_last_scene') || '-1', 10);
    const candidates = SCENES.map((_, idx) => idx).filter(idx => idx !== last);
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    localStorage.setItem('civiq_last_scene', String(chosen));
    return chosen;
  }

  let activeTimer = null;

  function stopActiveGameTimer() {
    if (activeTimer) {
      clearInterval(activeTimer);
      activeTimer = null;
    }
  }

  window.addEventListener('hashchange', stopActiveGameTimer);

  // ─── Render Game Page ─────────────────────────────────────────────────────

  function renderGamePage(app, options = {}) {
    stopActiveGameTimer();

    let sceneIndex = typeof options.sceneIndex === 'number' ? options.sceneIndex : pickNextSceneIndex();
    let duration = options.duration || 60;
    let timeLeft = duration;
    let score = 0;
    let streak = 0;
    let hintsLeft = 2;
    let muted = false;
    let status = 'playing'; // 'playing' | 'won' | 'lost'
    const foundIds = new Set();
    let lastLesson = null;

    // Pan & Zoom state
    let panX = -80;
    let panY = -60;
    let zoom = 1;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let movedDist = 0;

    const scene = SCENES[sceneIndex];

    const renderShell = () => {
      const bestScore = parseInt(localStorage.getItem('civiq_game_best') || '0', 10);

      app.innerHTML = `
        <div class="flex justify-between items-center mb-md flex-wrap gap-sm">
          <div>
            <h1>🎮 Civic Spotter Challenge</h1>
            <p class="text-sm text-muted">
              <strong>${scene.title}:</strong> ${scene.subtitle}
            </p>
          </div>
          <div class="flex gap-sm flex-wrap">
            <select id="game-difficulty" class="form-select" style="width:auto;" aria-label="Game difficulty">
              <option value="90" ${duration === 90 ? 'selected' : ''}>Relaxed (90s)</option>
              <option value="60" ${duration === 60 ? 'selected' : ''}>Standard (60s)</option>
              <option value="40" ${duration === 40 ? 'selected' : ''}>Blitz (40s)</option>
            </select>
            <button type="button" class="btn btn-secondary btn-sm" id="game-switch-scene">🔀 New Location</button>
            <button type="button" class="btn btn-ghost btn-sm" id="game-mute-btn">${muted ? '🔇 Muted' : '🔊 Sound'}</button>
          </div>
        </div>

        <div class="game-hud card mb-md">
          <div class="card-body flex justify-between items-center flex-wrap gap-md">
            <div class="game-hud-item">
              <span class="text-xs text-muted">Time Left</span>
              <strong id="game-timer" class="game-timer-val">${timeLeft}s</strong>
            </div>
            <div class="game-hud-item">
              <span class="text-xs text-muted">Issues Found</span>
              <strong id="game-found-count">${foundIds.size} / ${scene.issues.length}</strong>
            </div>
            <div class="game-hud-item">
              <span class="text-xs text-muted">Score &amp; Streak</span>
              <strong id="game-score">${score} pts <span class="badge badge-info" id="game-streak">x${Math.min(3, 1 + Math.floor(streak / 2))}</span></strong>
            </div>
            <div class="game-hud-item">
              <span class="text-xs text-muted">Best &amp; Rank</span>
              <strong id="game-best">${bestScore} pts · ${getCivicRank(bestScore)}</strong>
            </div>
            <div class="flex gap-xs">
              <button type="button" class="btn btn-secondary btn-sm" id="game-hint-btn">💡 Hint (${hintsLeft})</button>
              <button type="button" class="btn btn-ghost btn-sm" id="game-zoom-in" title="Zoom in">➕</button>
              <button type="button" class="btn btn-ghost btn-sm" id="game-zoom-out" title="Zoom out">➖</button>
              <button type="button" class="btn btn-ghost btn-sm" id="game-reset-view" title="Reset view">⌖ Reset</button>
            </div>
          </div>
        </div>

        <div class="game-layout">
          <div class="card game-stage-card">
            <div class="game-viewport" id="game-viewport" aria-label="Movable civic scene">
              <div class="game-canvas" id="game-canvas">
                <svg class="game-svg" id="game-svg" viewBox="0 0 ${SCENE_W} ${SCENE_H}" width="${SCENE_W}" height="${SCENE_H}">
                  ${scene.renderSvg()}
                  <g id="game-markers-layer"></g>
                </svg>
              </div>
              <div class="game-drag-hint">✋ Drag to move around · Click civic issues to spot them!</div>
            </div>
          </div>

          <aside class="card game-sidebar">
            <div class="card-header"><strong>Civic Checklist (${foundIds.size}/${scene.issues.length})</strong></div>
            <div class="card-body">
              <div id="game-lesson-box" class="mb-md">
                ${lastLesson ? `
                  <div class="emergency-banner" style="background: var(--color-mint-bg); border-color: var(--color-primary); color: var(--gray-900);">
                    <strong>✅ ${lastLesson.title}</strong> (${lastLesson.dept})<br>
                    <span class="text-xs">${lastLesson.tip}</span>
                  </div>
                ` : '<p class="text-xs text-muted">Click any civic issue in the animated scene to learn how it impacts the city.</p>'}
              </div>
              <ul class="game-checklist" id="game-checklist">
                ${scene.issues.map(iss => {
                  const found = foundIds.has(iss.id);
                  return `
                    <li class="game-check-item ${found ? 'found' : ''}">
                      <span>${found ? '✅' : '⬜'}</span>
                      <span>${found ? iss.title : 'Hidden civic issue…'}</span>
                    </li>
                  `;
                }).join('')}
              </ul>
              <div class="mt-md" id="game-end-panel" hidden></div>
            </div>
          </aside>
        </div>
      `;
    };

    renderShell();

    const viewport = document.getElementById('game-viewport');
    const canvas = document.getElementById('game-canvas');
    const markersLayer = document.getElementById('game-markers-layer');

    const applyTransform = () => {
      if (!viewport || !canvas) return;
      const vw = viewport.clientWidth || 700;
      const vh = viewport.clientHeight || 500;
      const minX = Math.min(0, vw - SCENE_W * zoom);
      const minY = Math.min(0, vh - SCENE_H * zoom);
      panX = Math.max(minX, Math.min(0, panX));
      panY = Math.max(minY, Math.min(0, panY));
      canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    };

    const updateHud = () => {
      const timerEl = document.getElementById('game-timer');
      const countEl = document.getElementById('game-found-count');
      const scoreEl = document.getElementById('game-score');
      const hintBtn = document.getElementById('game-hint-btn');
      const checklistEl = document.getElementById('game-checklist');
      const lessonEl = document.getElementById('game-lesson-box');

      if (timerEl) {
        timerEl.textContent = `${timeLeft}s`;
        timerEl.style.color = timeLeft <= 10 ? 'var(--color-danger)' : 'var(--color-primary-dark)';
      }
      if (countEl) countEl.textContent = `${foundIds.size} / ${scene.issues.length}`;
      if (scoreEl) {
        const mult = Math.min(3, 1 + Math.floor(streak / 2));
        scoreEl.innerHTML = `${score} pts <span class="badge badge-info">x${mult}</span>`;
      }
      if (hintBtn) {
        hintBtn.textContent = `💡 Hint (${hintsLeft})`;
        hintBtn.disabled = hintsLeft <= 0 || status !== 'playing';
      }
      if (checklistEl) {
        checklistEl.innerHTML = scene.issues.map(iss => {
          const found = foundIds.has(iss.id);
          return `<li class="game-check-item ${found ? 'found' : ''}"><span>${found ? '✅' : '⬜'}</span><span>${found ? iss.title : 'Hidden civic issue…'}</span></li>`;
        }).join('');
      }
      if (lessonEl && lastLesson) {
        lessonEl.innerHTML = `
          <div class="emergency-banner" style="background: var(--color-mint-bg); border-color: var(--color-primary); color: var(--gray-900);">
            <strong>✅ ${lastLesson.title}</strong> (${lastLesson.dept})<br>
            <span class="text-xs">${lastLesson.tip}</span>
          </div>
        `;
      }
    };

    const drawFoundMarker = (issue) => {
      if (!markersLayer) return;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.innerHTML = `
        <circle cx="${issue.x}" cy="${issue.y}" r="${issue.r * 0.72}" fill="rgba(30, 132, 73, 0.22)" stroke="#1e8449" stroke-width="5"/>
        <circle cx="${issue.x + issue.r * 0.48}" cy="${issue.y - issue.r * 0.48}" r="16" fill="#1e8449"/>
        <text x="${issue.x + issue.r * 0.48}" y="${issue.y - issue.r * 0.48 + 6}" text-anchor="middle" fill="#fff" font-size="18" font-weight="bold">✓</text>
      `;
      markersLayer.appendChild(g);
    };

    const drawFeedbackRipple = (svgX, svgY, color, label) => {
      if (!markersLayer) return;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'game-pop-feedback');
      g.innerHTML = `
        <circle cx="${svgX}" cy="${svgY}" r="22" fill="none" stroke="${color}" stroke-width="4"/>
        <text x="${svgX}" y="${svgY - 26}" text-anchor="middle" fill="${color}" font-size="18" font-weight="bold">${label}</text>
      `;
      markersLayer.appendChild(g);
      setTimeout(() => g.remove(), 800);
    };

    const finishGame = (didWin) => {
      stopActiveGameTimer();
      status = didWin ? 'won' : 'lost';
      if (didWin) {
        const timeBonus = timeLeft * 10;
        score += timeBonus;
        playTone('win', muted);
      }

      const prevBest = parseInt(localStorage.getItem('civiq_game_best') || '0', 10);
      if (score > prevBest) {
        localStorage.setItem('civiq_game_best', String(score));
      }
      const newBest = Math.max(score, prevBest);
      const bestEl = document.getElementById('game-best');
      if (bestEl) bestEl.textContent = `${newBest} pts · ${getCivicRank(newBest)}`;

      updateHud();

      // Reveal any missed issues in amber
      if (!didWin && markersLayer) {
        scene.issues.forEach(iss => {
          if (!foundIds.has(iss.id)) {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.innerHTML = `<circle cx="${iss.x}" cy="${iss.y}" r="${iss.r * 0.7}" fill="rgba(244, 180, 38, 0.25)" stroke="#f4b426" stroke-width="4" stroke-dasharray="8 6"/>`;
            markersLayer.appendChild(g);
          }
        });
      }

      const endPanel = document.getElementById('game-end-panel');
      if (endPanel) {
        endPanel.hidden = false;
        endPanel.innerHTML = `
          <div class="card" style="background: ${didWin ? 'var(--color-mint-bg)' : 'var(--color-warning-light)'}; padding: var(--space-md);">
            <h3 class="mb-xs">${didWin ? '🎉 City Cleared!' : '⏰ Time Up!'}</h3>
            <p class="text-sm mb-sm">
              You spotted <strong>${foundIds.size}/${scene.issues.length}</strong> civic issues
              and scored <strong>${score} pts</strong>!
            </p>
            <div class="flex gap-xs flex-wrap">
              <button type="button" class="btn btn-primary btn-sm" id="game-play-next">Play Different Scene</button>
              <a href="#/report/new" class="btn btn-secondary btn-sm">Report a Real Issue</a>
            </div>
          </div>
        `;
        document.getElementById('game-play-next')?.addEventListener('click', () => {
          renderGamePage(app, { duration });
        });
      }
    };

    // Start countdown
    activeTimer = setInterval(() => {
      if (status !== 'playing') return;
      timeLeft = Math.max(0, timeLeft - 1);
      updateHud();
      if (timeLeft === 0) {
        finishGame(false);
      }
    }, 1000);

    applyTransform();

    // Drag to pan + click to spot
    viewport?.addEventListener('pointerdown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      movedDist = 0;
      viewport.classList.add('dragging');
      viewport.setPointerCapture?.(e.pointerId);
    });

    viewport?.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      movedDist += Math.hypot(dx, dy);
      panX += dx;
      panY += dy;
      startX = e.clientX;
      startY = e.clientY;
      applyTransform();
    });

    viewport?.addEventListener('pointerup', (e) => {
      if (!isDragging) return;
      isDragging = false;
      viewport.classList.remove('dragging');
      if (movedDist > 8 || status !== 'playing') return; // Was a drag, not a click

      const rect = canvas.getBoundingClientRect();
      const svgX = (e.clientX - rect.left) / zoom;
      const svgY = (e.clientY - rect.top) / zoom;

      const hit = scene.issues.find(iss => !foundIds.has(iss.id) && Math.hypot(svgX - iss.x, svgY - iss.y) <= iss.r);
      if (hit) {
        foundIds.add(hit.id);
        streak += 1;
        const mult = Math.min(3, 1 + Math.floor((streak - 1) / 2));
        const gained = 100 * mult;
        score += gained;
        lastLesson = hit;
        playTone('hit', muted);
        drawFoundMarker(hit);
        drawFeedbackRipple(hit.x, hit.y, '#1e8449', `+${gained}`);
        updateHud();
        if (foundIds.size === scene.issues.length) {
          finishGame(true);
        }
      } else {
        // Check if clicked on an already-found issue (no penalty)
        const alreadyFound = scene.issues.find(iss => foundIds.has(iss.id) && Math.hypot(svgX - iss.x, svgY - iss.y) <= iss.r);
        if (!alreadyFound) {
          streak = 0;
          timeLeft = Math.max(0, timeLeft - 3);
          playTone('miss', muted);
          drawFeedbackRipple(svgX, svgY, '#c0392b', '-3s');
          updateHud();
          if (timeLeft === 0) finishGame(false);
        }
      }
    });

    // Wheel zoom
    viewport?.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.12 : -0.12;
      zoom = Math.max(0.75, Math.min(1.75, Math.round((zoom + delta) * 100) / 100));
      applyTransform();
    }, { passive: false });

    // Toolbar controls
    document.getElementById('game-zoom-in')?.addEventListener('click', () => {
      zoom = Math.min(1.75, Math.round((zoom + 0.15) * 100) / 100);
      applyTransform();
    });
    document.getElementById('game-zoom-out')?.addEventListener('click', () => {
      zoom = Math.max(0.75, Math.round((zoom - 0.15) * 100) / 100);
      applyTransform();
    });
    document.getElementById('game-reset-view')?.addEventListener('click', () => {
      zoom = 1;
      panX = -80;
      panY = -60;
      applyTransform();
    });

    document.getElementById('game-hint-btn')?.addEventListener('click', () => {
      if (hintsLeft <= 0 || status !== 'playing') return;
      const unfound = scene.issues.filter(iss => !foundIds.has(iss.id));
      if (unfound.length === 0) return;
      hintsLeft -= 1;
      const target = unfound[0];
      // Pan viewport smoothly toward the hinted issue
      const vw = viewport?.clientWidth || 700;
      const vh = viewport?.clientHeight || 500;
      panX = vw / 2 - target.x * zoom;
      panY = vh / 2 - target.y * zoom;
      applyTransform();

      if (markersLayer) {
        const pulse = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        pulse.setAttribute('cx', String(target.x));
        pulse.setAttribute('cy', String(target.y));
        pulse.setAttribute('r', String(target.r));
        pulse.setAttribute('fill', 'none');
        pulse.setAttribute('stroke', '#f4b426');
        pulse.setAttribute('stroke-width', '6');
        pulse.setAttribute('class', 'game-hint-pulse');
        markersLayer.appendChild(pulse);
        setTimeout(() => pulse.remove(), 2200);
      }
      updateHud();
    });

    document.getElementById('game-switch-scene')?.addEventListener('click', () => {
      renderGamePage(app, { duration });
    });

    document.getElementById('game-difficulty')?.addEventListener('change', (e) => {
      renderGamePage(app, { sceneIndex, duration: parseInt(e.target.value, 10) || 60 });
    });

    document.getElementById('game-mute-btn')?.addEventListener('click', (e) => {
      muted = !muted;
      e.currentTarget.textContent = muted ? '🔇 Muted' : '🔊 Sound';
    });
  }

  window.CivIQGame = { renderGamePage, SCENES };
})();
