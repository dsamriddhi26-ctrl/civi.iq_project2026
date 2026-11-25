/**
 * @module seed
 * Seed the Civ.IQ database with demo departments, users, reports, and reference data.
 * Idempotent — checks for existing data before inserting.
 */

const crypto = require('node:crypto');

/**
 * Seed the database with demo data.
 * Safe to call multiple times; skips seeding if departments already exist.
 *
 * @param {import('node:sqlite').DatabaseSync} db - An initialized database instance.
 */
function seedDatabase(db) {
  // ── Idempotency check ──────────────────────────────────────────────────
  const existing = db.prepare('SELECT COUNT(*) AS cnt FROM departments').get();
  if (existing.cnt > 0) {
    return; // Already seeded
  }

  // ── Departments ────────────────────────────────────────────────────────
  const departments = [
    { id: crypto.randomUUID(), name: 'Roads & Infrastructure',  description: 'Potholes, road damage, footpath issues, and general road infrastructure' },
    { id: crypto.randomUUID(), name: 'Sanitation',              description: 'Garbage collection, waste disposal, and cleanliness issues' },
    { id: crypto.randomUUID(), name: 'Animal Control',          description: 'Stray animal management, animal-related complaints' },
    { id: crypto.randomUUID(), name: 'Street Lighting',         description: 'Streetlight repairs, outages, and new installations' },
    { id: crypto.randomUUID(), name: 'Water & Drainage',        description: 'Water supply, drainage blockages, waterlogging, and sewage' },
    { id: crypto.randomUUID(), name: 'General Services',        description: 'Miscellaneous civic issues and general requests' }
  ];

  const insertDept = db.prepare(
    'INSERT INTO departments (id, name, description) VALUES (?, ?, ?)'
  );
  for (const d of departments) {
    insertDept.run(d.id, d.name, d.description);
  }

  // Build a lookup map: name → id
  const deptMap = {};
  for (const d of departments) {
    deptMap[d.name] = d.id;
  }

  // ── Service Areas ──────────────────────────────────────────────────────
  const serviceAreas = [
    { id: crypto.randomUUID(), deptName: 'Roads & Infrastructure',  name: 'Pothole Repair',        description: 'Filling and repairing potholes on roads' },
    { id: crypto.randomUUID(), deptName: 'Roads & Infrastructure',  name: 'Road Resurfacing',      description: 'Full road resurfacing projects' },
    { id: crypto.randomUUID(), deptName: 'Roads & Infrastructure',  name: 'Footpath Maintenance',  description: 'Repair and maintenance of footpaths and sidewalks' },
    { id: crypto.randomUUID(), deptName: 'Sanitation',              name: 'Garbage Collection',    description: 'Regular garbage collection and pickup' },
    { id: crypto.randomUUID(), deptName: 'Sanitation',              name: 'Street Sweeping',       description: 'Street and public area cleaning' },
    { id: crypto.randomUUID(), deptName: 'Animal Control',          name: 'Stray Dog Management',  description: 'Stray dog catching, vaccination, and ABC programs' },
    { id: crypto.randomUUID(), deptName: 'Animal Control',          name: 'Animal Rescue',         description: 'Injured or trapped animal rescue' },
    { id: crypto.randomUUID(), deptName: 'Street Lighting',         name: 'Light Repair',          description: 'Repairing broken or flickering streetlights' },
    { id: crypto.randomUUID(), deptName: 'Street Lighting',         name: 'New Installation',      description: 'Requests for new streetlight installation' },
    { id: crypto.randomUUID(), deptName: 'Water & Drainage',        name: 'Drain Clearing',        description: 'Clearing blocked drains and nallas' },
    { id: crypto.randomUUID(), deptName: 'Water & Drainage',        name: 'Water Supply',          description: 'Water supply issues and leaks' },
    { id: crypto.randomUUID(), deptName: 'General Services',        name: 'General Requests',      description: 'Miscellaneous civic requests' }
  ];

  const insertSA = db.prepare(
    'INSERT INTO service_areas (id, department_id, name, description) VALUES (?, ?, ?, ?)'
  );
  const saMap = {};
  for (const sa of serviceAreas) {
    insertSA.run(sa.id, deptMap[sa.deptName], sa.name, sa.description);
    saMap[sa.name] = sa.id;
  }

  // ── Routing Rules ──────────────────────────────────────────────────────
  const routingRules = [
    { category: 'pothole',         deptName: 'Roads & Infrastructure',  saName: 'Pothole Repair',       priority: 10 },
    { category: 'garbage',         deptName: 'Sanitation',              saName: 'Garbage Collection',    priority: 10 },
    { category: 'stray_animal',    deptName: 'Animal Control',          saName: 'Stray Dog Management',  priority: 10 },
    { category: 'streetlight',     deptName: 'Street Lighting',         saName: 'Light Repair',          priority: 10 },
    { category: 'water_drainage',  deptName: 'Water & Drainage',        saName: 'Drain Clearing',        priority: 10 },
    { category: 'other',           deptName: 'General Services',        saName: 'General Requests',      priority: 0 }
  ];

  const insertRule = db.prepare(
    'INSERT INTO routing_rules (id, category, department_id, service_area_id, priority) VALUES (?, ?, ?, ?, ?)'
  );
  for (const r of routingRules) {
    insertRule.run(
      crypto.randomUUID(),
      r.category,
      deptMap[r.deptName],
      saMap[r.saName] || null,
      r.priority
    );
  }

  // ── Users ──────────────────────────────────────────────────────────────
  const users = [
    { id: crypto.randomUUID(), email: 'priya@demo.civiq.local',  display_name: 'Priya Sharma', role: 'citizen', department_id: null },
    { id: crypto.randomUUID(), email: 'rahul@demo.civiq.local',  display_name: 'Rahul Verma',  role: 'citizen', department_id: null },
    { id: crypto.randomUUID(), email: 'meera@demo.civiq.local',  display_name: 'Meera Patel',  role: 'staff',   department_id: deptMap['Roads & Infrastructure'] },
    { id: crypto.randomUUID(), email: 'arjun@demo.civiq.local',  display_name: 'Arjun Singh',  role: 'admin',   department_id: null }
  ];

  const insertUser = db.prepare(
    'INSERT INTO users (id, email, display_name, role, department_id) VALUES (?, ?, ?, ?, ?)'
  );
  for (const u of users) {
    insertUser.run(u.id, u.email, u.display_name, u.role, u.department_id);
  }

  const userMap = {};
  for (const u of users) {
    userMap[u.display_name] = u.id;
  }

  // ── SLA Settings ───────────────────────────────────────────────────────
  const slaSettings = [
    { priority: 'critical', target_hours: 4,  escalation_hours: 2 },
    { priority: 'medium',   target_hours: 24, escalation_hours: 12 },
    { priority: 'low',      target_hours: 72, escalation_hours: 48 }
  ];

  const insertSLA = db.prepare(
    'INSERT INTO sla_settings (id, priority, target_hours, escalation_hours) VALUES (?, ?, ?, ?)'
  );
  for (const s of slaSettings) {
    insertSLA.run(crypto.randomUUID(), s.priority, s.target_hours, s.escalation_hours);
  }

  // ── App Settings ───────────────────────────────────────────────────────
  const insertSetting = db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?)'
  );
  insertSetting.run(
    'emergency_guidance',
    'For emergencies, dial 112 (National Emergency) or 100 (Police). Civ.IQ is for non-emergency civic issues only.'
  );
  insertSetting.run('duplicate_radius_meters', '500');

  // ── Demo Reports ───────────────────────────────────────────────────────
  // Helper to create ISO timestamp offset from "now" (negative = past)
  const hoursAgo = (h) => {
    const d = new Date(Date.now() - h * 3600000);
    return d.toISOString().replace('T', ' ').substring(0, 19);
  };

  // Helper to calculate SLA deadline
  const slaDeadline = (createdAt, priorityName) => {
    const sla = slaSettings.find(s => s.priority === priorityName);
    if (!sla) return null;
    const created = new Date(createdAt.replace(' ', 'T') + 'Z');
    const deadline = new Date(created.getTime() + sla.target_hours * 3600000);
    return deadline.toISOString().replace('T', ' ').substring(0, 19);
  };

  const insertReport = db.prepare(`
    INSERT INTO reports (
      id, report_number, user_id, category, description,
      latitude, longitude, address, is_anonymous,
      status, priority, department_id, assigned_to,
      classification_source, sla_deadline,
      upvote_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const reports = [
    {
      id: crypto.randomUUID(),
      number: 'CIV-2026-00001',
      user: 'Priya Sharma',
      category: 'pothole',
      description: 'Large pothole on SV Road near Andheri station causing traffic jams. Multiple vehicles have been damaged. The hole is approximately 2 feet wide and 1 foot deep. Very dangerous during monsoon.',
      lat: 19.1197, lng: 72.8464,
      address: 'SV Road, Andheri West, Mumbai 400058',
      status: 'in_progress', priority: 'critical',
      dept: 'Roads & Infrastructure', assignedTo: 'Meera Patel',
      hoursAgo: 48
    },
    {
      id: crypto.randomUUID(),
      number: 'CIV-2026-00002',
      user: 'Rahul Verma',
      category: 'garbage',
      description: 'Garbage has not been collected from the community bins near Juhu Beach for over 3 days. The bins are overflowing and waste is spreading onto the road. Terrible smell, attracting stray dogs.',
      lat: 19.0988, lng: 72.8267,
      address: 'Juhu Tara Road, Juhu, Mumbai 400049',
      status: 'assigned', priority: 'medium',
      dept: 'Sanitation', assignedTo: null,
      hoursAgo: 36
    },
    {
      id: crypto.randomUUID(),
      number: 'CIV-2026-00003',
      user: 'Priya Sharma',
      category: 'streetlight',
      description: 'Three consecutive streetlights are not working on Carter Road near the promenade. The area becomes very dark after 7 PM and feels unsafe for evening walkers, especially women.',
      lat: 19.0830, lng: 72.8276,
      address: 'Carter Road, Bandra West, Mumbai 400050',
      status: 'submitted', priority: 'medium',
      dept: 'Street Lighting', assignedTo: null,
      hoursAgo: 12
    },
    {
      id: crypto.randomUUID(),
      number: 'CIV-2026-00004',
      user: 'Rahul Verma',
      category: 'stray_animal',
      description: 'A pack of around 8-10 stray dogs has been aggressive towards pedestrians and children near the school gate. They are especially active in the morning hours. Residents are concerned about safety.',
      lat: 19.0760, lng: 72.8777,
      address: 'Near Don Bosco School, Matunga, Mumbai 400019',
      status: 'under_review', priority: 'critical',
      dept: 'Animal Control', assignedTo: null,
      hoursAgo: 24
    },
    {
      id: crypto.randomUUID(),
      number: 'CIV-2026-00005',
      user: 'Priya Sharma',
      category: 'water_drainage',
      description: 'Major waterlogging on the main road after every rain. The drainage system seems completely blocked. Water stagnates for hours causing mosquito breeding. Flooding hazard during heavy rains.',
      lat: 19.0178, lng: 72.8478,
      address: 'Hindmata Junction, Parel, Mumbai 400012',
      status: 'assigned', priority: 'critical',
      dept: 'Water & Drainage', assignedTo: 'Meera Patel',
      hoursAgo: 72
    },
    {
      id: crypto.randomUUID(),
      number: 'CIV-2026-00006',
      user: 'Rahul Verma',
      category: 'pothole',
      description: 'Small pothole forming near the bus stop. Not too deep yet but will get worse in monsoon season. Requesting minor repair when possible.',
      lat: 19.1075, lng: 72.8370,
      address: 'Link Road, Khar West, Mumbai 400052',
      status: 'submitted', priority: 'low',
      dept: 'Roads & Infrastructure', assignedTo: null,
      hoursAgo: 6
    },
    {
      id: crypto.randomUUID(),
      number: 'CIV-2026-00007',
      user: 'Priya Sharma',
      category: 'garbage',
      description: 'Construction debris dumped illegally on the footpath near Dadar flower market. Blocking pedestrian walkway completely. Pedestrians forced to walk on the busy road.',
      lat: 19.0595, lng: 72.8440,
      address: 'Senapati Bapat Marg, Dadar West, Mumbai 400028',
      status: 'resolved', priority: 'medium',
      dept: 'Sanitation', assignedTo: null,
      hoursAgo: 120
    },
    {
      id: crypto.randomUUID(),
      number: 'CIV-2026-00008',
      user: 'Rahul Verma',
      category: 'other',
      description: 'Public bench in the park is broken — the wooden slats are cracked and nails are exposed. Children play nearby and could get hurt. It is a cosmetic issue but could become dangerous.',
      lat: 19.0896, lng: 72.8656,
      address: 'Five Gardens, Matunga East, Mumbai 400019',
      status: 'submitted', priority: 'low',
      dept: 'General Services', assignedTo: null,
      hoursAgo: 4
    },
    {
      id: crypto.randomUUID(),
      number: 'CIV-2026-00009',
      user: 'Rahul Verma',
      category: 'streetlight',
      description: 'Exposed electrical wire hanging from a damaged streetlight pole. Extremely hazardous, especially in rain. Urgent repair needed before someone is electrocuted.',
      lat: 19.0410, lng: 72.8420,
      address: 'Prabhadevi, Mumbai 400025',
      status: 'in_progress', priority: 'critical',
      dept: 'Street Lighting', assignedTo: 'Meera Patel',
      hoursAgo: 8
    },
    {
      id: crypto.randomUUID(),
      number: 'CIV-2026-00010',
      user: 'Priya Sharma',
      category: 'water_drainage',
      description: 'Minor water leak from a roadside pipe. Small puddle forming. Not urgent but should be fixed eventually to avoid wastage.',
      lat: 19.0650, lng: 72.8350,
      address: 'Mahim Causeway, Mahim, Mumbai 400016',
      status: 'closed', priority: 'low',
      dept: 'Water & Drainage', assignedTo: null,
      hoursAgo: 200
    }
  ];

  for (const r of reports) {
    const createdAt = hoursAgo(r.hoursAgo);
    const updatedAt = hoursAgo(Math.max(0, r.hoursAgo - 2)); // Updated slightly after creation
    const deadline = slaDeadline(createdAt, r.priority);
    const assignedUserId = r.assignedTo ? userMap[r.assignedTo] : null;

    insertReport.run(
      r.id, r.number, userMap[r.user], r.category, r.description,
      r.lat, r.lng, r.address, 0,
      r.status, r.priority, deptMap[r.dept], assignedUserId,
      'rules_engine', deadline,
      0, // upvote_count — will be updated after upvotes are inserted
      createdAt, updatedAt
    );
  }

  // ── Status History ─────────────────────────────────────────────────────
  const insertHistory = db.prepare(
    `INSERT INTO status_history (id, report_id, old_status, new_status, changed_by, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  // Report 1 (pothole, critical): submitted → under_review → assigned → in_progress
  insertHistory.run(crypto.randomUUID(), reports[0].id, null, 'submitted', userMap['Priya Sharma'], 'Report submitted', hoursAgo(48));
  insertHistory.run(crypto.randomUUID(), reports[0].id, 'submitted', 'under_review', userMap['Arjun Singh'], 'Reviewing report details', hoursAgo(44));
  insertHistory.run(crypto.randomUUID(), reports[0].id, 'under_review', 'assigned', userMap['Arjun Singh'], 'Assigned to Roads department', hoursAgo(40));
  insertHistory.run(crypto.randomUUID(), reports[0].id, 'assigned', 'in_progress', userMap['Meera Patel'], 'Road crew dispatched', hoursAgo(36));

  // Report 4 (stray_animal, critical): submitted → under_review
  insertHistory.run(crypto.randomUUID(), reports[3].id, null, 'submitted', userMap['Rahul Verma'], 'Report submitted', hoursAgo(24));
  insertHistory.run(crypto.randomUUID(), reports[3].id, 'submitted', 'under_review', userMap['Arjun Singh'], 'Investigating stray dog complaint', hoursAgo(20));

  // Report 7 (garbage, resolved): submitted → assigned → in_progress → resolved
  insertHistory.run(crypto.randomUUID(), reports[6].id, null, 'submitted', userMap['Priya Sharma'], 'Report submitted', hoursAgo(120));
  insertHistory.run(crypto.randomUUID(), reports[6].id, 'submitted', 'assigned', userMap['Arjun Singh'], 'Assigned to sanitation team', hoursAgo(110));
  insertHistory.run(crypto.randomUUID(), reports[6].id, 'assigned', 'in_progress', userMap['Arjun Singh'], 'Cleanup crew en route', hoursAgo(100));
  insertHistory.run(crypto.randomUUID(), reports[6].id, 'in_progress', 'resolved', userMap['Arjun Singh'], 'Debris cleared and footpath restored', hoursAgo(96));

  // Report 9 (exposed wire, critical): submitted → under_review → in_progress
  insertHistory.run(crypto.randomUUID(), reports[8].id, null, 'submitted', userMap['Rahul Verma'], 'Report submitted', hoursAgo(8));
  insertHistory.run(crypto.randomUUID(), reports[8].id, 'submitted', 'under_review', userMap['Arjun Singh'], 'Urgent: exposed wire hazard', hoursAgo(7));
  insertHistory.run(crypto.randomUUID(), reports[8].id, 'under_review', 'in_progress', userMap['Meera Patel'], 'Emergency repair team dispatched', hoursAgo(6));

  // Report 10 (closed): submitted → resolved → closed
  insertHistory.run(crypto.randomUUID(), reports[9].id, null, 'submitted', userMap['Priya Sharma'], 'Report submitted', hoursAgo(200));
  insertHistory.run(crypto.randomUUID(), reports[9].id, 'submitted', 'resolved', userMap['Arjun Singh'], 'Pipe leak fixed', hoursAgo(180));
  insertHistory.run(crypto.randomUUID(), reports[9].id, 'resolved', 'closed', userMap['Arjun Singh'], 'Confirmed resolved, closing', hoursAgo(170));

  // ── Assignments ────────────────────────────────────────────────────────
  const insertAssignment = db.prepare(
    `INSERT INTO assignments (id, report_id, assigned_to, department_id, assigned_by, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  insertAssignment.run(crypto.randomUUID(), reports[0].id, userMap['Meera Patel'], deptMap['Roads & Infrastructure'], userMap['Arjun Singh'], 'Assigned to Meera for road repair coordination', hoursAgo(40));
  insertAssignment.run(crypto.randomUUID(), reports[4].id, userMap['Meera Patel'], deptMap['Water & Drainage'], userMap['Arjun Singh'], 'Critical drainage issue at Hindmata', hoursAgo(68));
  insertAssignment.run(crypto.randomUUID(), reports[8].id, userMap['Meera Patel'], deptMap['Street Lighting'], userMap['Arjun Singh'], 'Emergency: exposed electrical wire', hoursAgo(6));

  // ── Internal Notes ─────────────────────────────────────────────────────
  const insertNote = db.prepare(
    `INSERT INTO internal_notes (id, report_id, user_id, content, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  insertNote.run(crypto.randomUUID(), reports[0].id, userMap['Meera Patel'], 'Road crew confirms pothole is 2x1 feet. Will need full patch, not just temporary fill. Estimated completion: 2 days.', hoursAgo(35));
  insertNote.run(crypto.randomUUID(), reports[0].id, userMap['Arjun Singh'], 'This is a high-traffic area. Coordinate with traffic police for lane closure during repair.', hoursAgo(30));
  insertNote.run(crypto.randomUUID(), reports[3].id, userMap['Arjun Singh'], 'Contacted local ABC (Animal Birth Control) center. They will send a team for sterilization drive in the area.', hoursAgo(18));
  insertNote.run(crypto.randomUUID(), reports[8].id, userMap['Meera Patel'], 'BESCOM team on site. Wire has been temporarily insulated. Permanent fix requires new pole — ordered.', hoursAgo(4));

  // ── Citizen Updates ────────────────────────────────────────────────────
  const insertUpdate = db.prepare(
    `INSERT INTO citizen_updates (id, report_id, user_id, content, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  insertUpdate.run(crypto.randomUUID(), reports[0].id, userMap['Priya Sharma'], 'The pothole seems to have gotten bigger after yesterday\'s rain. Please prioritize this.', hoursAgo(30));
  insertUpdate.run(crypto.randomUUID(), reports[1].id, userMap['Rahul Verma'], 'Still no garbage pickup. The situation is getting worse. Rats spotted near the bins.', hoursAgo(20));
  insertUpdate.run(crypto.randomUUID(), reports[6].id, userMap['Priya Sharma'], 'Thank you! The footpath has been fully cleared. Great work by the sanitation team.', hoursAgo(95));

  // ── Upvotes ────────────────────────────────────────────────────────────
  const insertUpvote = db.prepare(
    `INSERT INTO upvotes (id, report_id, user_id, created_at) VALUES (?, ?, ?, ?)`
  );
  const updateUpvoteCount = db.prepare(
    `UPDATE reports SET upvote_count = (SELECT COUNT(*) FROM upvotes WHERE report_id = ?) WHERE id = ?`
  );

  // Report 1 (dangerous pothole) — both other users upvoted
  insertUpvote.run(crypto.randomUUID(), reports[0].id, userMap['Rahul Verma'], hoursAgo(45));
  insertUpvote.run(crypto.randomUUID(), reports[0].id, userMap['Meera Patel'], hoursAgo(42));
  updateUpvoteCount.run(reports[0].id, reports[0].id);

  // Report 2 (garbage) — Priya upvoted
  insertUpvote.run(crypto.randomUUID(), reports[1].id, userMap['Priya Sharma'], hoursAgo(30));
  updateUpvoteCount.run(reports[1].id, reports[1].id);

  // Report 4 (stray animals) — Priya upvoted
  insertUpvote.run(crypto.randomUUID(), reports[3].id, userMap['Priya Sharma'], hoursAgo(22));
  updateUpvoteCount.run(reports[3].id, reports[3].id);

  // Report 5 (waterlogging) — Rahul upvoted
  insertUpvote.run(crypto.randomUUID(), reports[4].id, userMap['Rahul Verma'], hoursAgo(60));
  updateUpvoteCount.run(reports[4].id, reports[4].id);

  // Report 9 (exposed wire) — Priya and Arjun upvoted
  insertUpvote.run(crypto.randomUUID(), reports[8].id, userMap['Priya Sharma'], hoursAgo(7));
  insertUpvote.run(crypto.randomUUID(), reports[8].id, userMap['Arjun Singh'], hoursAgo(6));
  updateUpvoteCount.run(reports[8].id, reports[8].id);

  // ── Notifications ──────────────────────────────────────────────────────
  const insertNotif = db.prepare(
    `INSERT INTO notifications (id, user_id, report_id, type, title, message, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // Priya's notifications
  insertNotif.run(crypto.randomUUID(), userMap['Priya Sharma'], reports[0].id, 'status_change',
    'Report Update: CIV-2026-00001',
    'Your pothole report on SV Road is now in progress. A road crew has been dispatched.',
    1, hoursAgo(36));

  insertNotif.run(crypto.randomUUID(), userMap['Priya Sharma'], reports[2].id, 'submitted',
    'Report Submitted: CIV-2026-00003',
    'Your streetlight report for Carter Road has been submitted successfully.',
    1, hoursAgo(12));

  insertNotif.run(crypto.randomUUID(), userMap['Priya Sharma'], reports[6].id, 'status_change',
    'Report Resolved: CIV-2026-00007',
    'Your garbage report at Dadar has been resolved. The debris has been cleared.',
    0, hoursAgo(96));

  // Rahul's notifications
  insertNotif.run(crypto.randomUUID(), userMap['Rahul Verma'], reports[1].id, 'status_change',
    'Report Update: CIV-2026-00002',
    'Your garbage collection report near Juhu Beach has been assigned to the sanitation team.',
    0, hoursAgo(30));

  insertNotif.run(crypto.randomUUID(), userMap['Rahul Verma'], reports[3].id, 'status_change',
    'Report Update: CIV-2026-00004',
    'Your stray animal report near Don Bosco School is under review.',
    0, hoursAgo(20));

  // Meera's notifications (staff)
  insertNotif.run(crypto.randomUUID(), userMap['Meera Patel'], reports[0].id, 'assigned',
    'New Assignment: CIV-2026-00001',
    'You have been assigned a critical pothole report on SV Road, Andheri West.',
    1, hoursAgo(40));

  insertNotif.run(crypto.randomUUID(), userMap['Meera Patel'], reports[8].id, 'assigned',
    'Emergency Assignment: CIV-2026-00009',
    'URGENT: You have been assigned an exposed wire hazard report at Prabhadevi.',
    0, hoursAgo(6));

  // Arjun's notifications (admin)
  insertNotif.run(crypto.randomUUID(), userMap['Arjun Singh'], null, 'system',
    'Welcome to Civ.IQ',
    'Welcome to the Civ.IQ admin dashboard. You have full access to all reports and settings.',
    1, hoursAgo(500));
}

module.exports = { seedDatabase };
