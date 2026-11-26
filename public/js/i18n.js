/**
 * Civ.IQ — Accessibility, Language (English + Hindi Demo), and Simple-Language Module
 *
 * Persists selected language ('civiq_lang') and simple-language mode ('civiq_simple_lang')
 * in localStorage, updates <html lang>, and announces updates via #sr-announcer.
 * Note: User-submitted report descriptions, comments, and staff notes are never auto-translated.
 */

(function () {
  'use strict';

  const STRINGS = {
    en: {
      // Navigation
      nav_home: 'Home',
      nav_report: 'Report Issue',
      nav_my_reports: 'My Reports',
      nav_community: 'Community',
      nav_leaderboard: 'Leaderboard',
      nav_reviews: 'Reviews',
      nav_game: '🎮 Game',
      nav_dashboard: 'Dashboard',
      nav_queue: 'Staff Queue',
      nav_escalations: 'Escalations',
      nav_departments: 'Departments',
      nav_sla: 'SLA',
      nav_users: 'Users',
      nav_settings: 'Settings',

      // Accessibility controls
      lang_label: 'Language',
      simple_label: 'Simple words',

      // Home & Guidance
      hero_title: 'Report civic issues. Track resolution. Shape a cleaner city.',
      hero_desc: 'Civ.IQ connects citizens with municipal departments to report potholes, waste, streetlights, drainage, and stray animal issues with live geo-tagged maps and heatmaps.',
      btn_report_issue: '+ Report an Issue',
      btn_community_map: '🗺️ Community & Heatmap',
      btn_civic_game: '🎮 Civic Game',
      btn_reviews: '⭐ App Reviews',
      emergency_title: '⚠️ Not an Emergency Service:',
      emergency_body: 'Civ.IQ is for non-emergency civic maintenance only. For immediate life-safety, fire, medical, or crime emergencies, dial your local emergency number (e.g., 112 / 100).',

      // Report Form
      form_title: 'Report a Civic Issue',
      step_1: '1. Issue Details',
      step_2: '2. Location',
      step_3: '3. Review & Submit',
      lbl_category: 'Category',
      lbl_severity: 'Severity',
      sev_low: 'Low — Minor or cosmetic issue',
      sev_medium: 'Medium — Needs standard attention',
      sev_high: 'High — Urgent / safety hazard',
      lbl_description: 'Description',
      desc_placeholder: 'Describe the location, severity, and details of the issue (minimum 20 characters)...',
      desc_help: 'Minimum 20 characters. Include safety hazards if applicable.',
      err_desc_short: 'Please enter at least 20 characters describing the issue.',
      lbl_photo: 'Photo Evidence',
      lbl_optional: '(optional)',
      lbl_anon: 'Hide my name from the public community feed',
      anon_help: 'Your identity will be hidden from the community feed (shown as "Community Member"), but remains visible to authorized municipal staff for verification.',
      btn_cancel: 'Cancel',
      btn_next_loc: 'Next: Location →',
      btn_back: '← Back',
      btn_next_review: 'Next: Review →',
      btn_submit_report: 'Submit Report',
      btn_submitting: 'Submitting…',
      review_title: 'Review & Submit',
      dup_header: 'Potential Nearby Duplicates',
      dup_none: 'No matching nearby reports found.',
      dup_support_hint: 'Found an existing report for this same issue? Open it to support it instead of creating a duplicate.',
      btn_view_support: 'View & Support →',

      // Categories
      cat_pothole: 'Pothole/Road Damage',
      cat_garbage: 'Garbage/Waste',
      cat_stray_animal: 'Stray Animal',
      cat_streetlight: 'Streetlight',
      cat_water_drainage: 'Water/Drainage',
      cat_other: 'Other',

      // Statuses & Explanations
      st_submitted: 'Submitted',
      st_under_review: 'Under Review',
      st_assigned: 'Assigned',
      st_in_progress: 'In Progress',
      st_resolved: 'Resolved',
      st_closed: 'Closed',
      st_reopened: 'Reopened',
      exp_submitted: 'Your report has been received and logged.',
      exp_under_review: 'Municipal staff are reviewing the details.',
      exp_assigned: 'Assigned to a municipal department or crew.',
      exp_in_progress: 'Work is actively underway.',
      exp_resolved: 'Staff marked this fixed. Community verification may be open.',
      exp_closed: 'This report is closed.',
      exp_reopened: 'Reopened for follow-up work.',

      // Priorities
      pr_critical: 'Critical',
      pr_medium: 'Medium',
      pr_low: 'Low',

      // Support & Verification
      btn_support: '🤝 Support This Report',
      btn_supported: '✓ Supporting (Remove Support)',
      support_closed_msg: 'This report is already resolved/closed and cannot receive new support.',
      verif_heading: 'Community Resolution Verification',
      verif_awaiting: '⏳ Awaiting Community Verification',
      verif_verified: '✅ Verified Resolved by Community',
      verif_followup: '⚠️ Needs Follow-up',
      verif_closed: '🔒 Closed & Confirmed',
      verif_fixed_btn: '✅ This issue is fixed',
      verif_still_btn: '⚠️ This issue is still present',
      verif_submit: 'Submit Verification Vote',
      original_text_note: 'Original submitted text (not auto-translated)'
    },

    hi: {
      // Navigation (Demo Hindi translation)
      nav_home: 'मुख्य पृष्ठ',
      nav_report: 'समस्या दर्ज करें',
      nav_my_reports: 'मेरी रिपोर्ट्स',
      nav_community: 'समुदाय',
      nav_leaderboard: 'लीडरबोर्ड',
      nav_reviews: 'समीक्षाएं',
      nav_game: '🎮 खेल',
      nav_dashboard: 'डैशबोर्ड',
      nav_queue: 'स्टाफ कतार',
      nav_escalations: 'एस्केलेशन',
      nav_departments: 'विभाग',
      nav_sla: 'SLA नियम',
      nav_users: 'उपयोगकर्ता',
      nav_settings: 'सेटिंग्स',

      // Accessibility controls
      lang_label: 'भाषा',
      simple_label: 'सरल भाषा',

      // Home & Guidance
      hero_title: 'नागरिक समस्या दर्ज करें। समाधान ट्रैक करें। स्वच्छ शहर बनाएं।',
      hero_desc: 'Civ.IQ नागरिकों को नगर निगम विभागों से जोड़ता है ताकि गड्ढे, कचरा, स्ट्रीटलाइट, जल निकासी और आवारा पशुओं की समस्याएं मानचित्र और हीटमैप के साथ हल हो सकें।',
      btn_report_issue: '+ समस्या दर्ज करें',
      btn_community_map: '🗺️ समुदाय और हीटमैप',
      btn_civic_game: '🎮 नागरिक खेल',
      btn_reviews: '⭐ ऐप समीक्षाएं',
      emergency_title: '⚠️ यह आपातकालीन सेवा नहीं है:',
      emergency_body: 'Civ.IQ केवल गैर-आपातकालीन नागरिक समस्याओं के लिए है। आग, चिकित्सा या पुलिस आपातकाल के लिए कृपया 112 या 100 पर कॉल करें।',

      // Report Form
      form_title: 'नागरिक समस्या दर्ज करें',
      step_1: '1. समस्या विवरण',
      step_2: '2. स्थान',
      step_3: '3. समीक्षा और सबमिट',
      lbl_category: 'श्रेणी',
      lbl_severity: 'गंभीरता',
      sev_low: 'कम — मामूली समस्या',
      sev_medium: 'मध्यम — सामान्य ध्यान आवश्यक',
      sev_high: 'उच्च — तत्काल / सुरक्षा खतरा',
      lbl_description: 'विवरण',
      desc_placeholder: 'समस्या का स्थान, गंभीरता और विवरण लिखें (कम से कम 20 अक्षर)...',
      desc_help: 'कम से कम 20 अक्षर लिखें। यदि कोई सुरक्षा खतरा है तो अवश्य बताएं।',
      err_desc_short: 'कृपया समस्या का वर्णन करने के लिए कम से कम 20 अक्षर दर्ज करें।',
      lbl_photo: 'फोटो प्रमाण',
      lbl_optional: '(वैकल्पिक)',
      lbl_anon: 'सार्वजनिक फ़ीड में मेरा नाम छिपाएं',
      anon_help: 'सार्वजनिक फ़ीड में आपका नाम "Community Member" दिखेगा, लेकिन सत्यापन के लिए अधिकृत स्टाफ को दिखाई देगा।',
      btn_cancel: 'रद्द करें',
      btn_next_loc: 'आगे: स्थान →',
      btn_back: '← पीछे',
      btn_next_review: 'आगे: समीक्षा →',
      btn_submit_report: 'रिपोर्ट सबमिट करें',
      btn_submitting: 'सबमिट हो रहा है…',
      review_title: 'समीक्षा और सबमिट',
      dup_header: 'संभावित नज़दीकी समान रिपोर्ट्स',
      dup_none: 'आसपास कोई समान रिपोर्ट नहीं मिली।',
      dup_support_hint: 'क्या यही समस्या पहले से दर्ज है? नई रिपोर्ट बनाने के बजाय उसे खोलकर समर्थन करें।',
      btn_view_support: 'देखें और समर्थन करें →',

      // Categories
      cat_pothole: 'गड्ढा / सड़क क्षति',
      cat_garbage: 'कचरा / गंदगी',
      cat_stray_animal: 'आवारा पशु',
      cat_streetlight: 'स्ट्रीटलाइट',
      cat_water_drainage: 'पानी / जल निकासी',
      cat_other: 'अन्य',

      // Statuses & Explanations
      st_submitted: 'दर्ज की गई',
      st_under_review: 'समीक्षाधीन',
      st_assigned: 'सौंपी गई',
      st_in_progress: 'कार्य प्रगति पर',
      st_resolved: 'हल हो गई',
      st_closed: 'बंद',
      st_reopened: 'पुनः खोली गई',
      exp_submitted: 'आपकी रिपोर्ट प्राप्त हो गई है।',
      exp_under_review: 'नगर निगम स्टाफ विवरण की जांच कर रहा है।',
      exp_assigned: 'संबंधित विभाग या टीम को सौंप दी गई है।',
      exp_in_progress: 'समस्या को ठीक करने का काम चल रहा है।',
      exp_resolved: 'स्टाफ ने इसे ठीक बताया है। सामुदायिक सत्यापन खुला हो सकता है।',
      exp_closed: 'यह रिपोर्ट बंद कर दी गई है।',
      exp_reopened: 'आगे की कार्रवाई के लिए पुनः खोली गई है।',

      // Priorities
      pr_critical: 'गंभीर',
      pr_medium: 'मध्यम',
      pr_low: 'कम',

      // Support & Verification
      btn_support: '🤝 इस रिपोर्ट का समर्थन करें',
      btn_supported: '✓ समर्थित (समर्थन हटाएं)',
      support_closed_msg: 'यह रिपोर्ट पहले ही हल या बंद हो चुकी है, इसलिए नया समर्थन नहीं जोड़ा जा सकता।',
      verif_heading: 'सामुदायिक समाधान सत्यापन',
      verif_awaiting: '⏳ सामुदायिक सत्यापन की प्रतीक्षा',
      verif_verified: '✅ समुदाय द्वारा हल सत्यापित',
      verif_followup: '⚠️ अनुवर्ती कार्रवाई आवश्यक',
      verif_closed: '🔒 बंद और पुष्ट',
      verif_fixed_btn: '✅ यह समस्या ठीक हो गई है',
      verif_still_btn: '⚠️ यह समस्या अभी भी मौजूद है',
      verif_submit: 'सत्यापन वोट सबमिट करें',
      original_text_note: 'मूल सबमिट किया गया पाठ (स्वचालित अनुवादित नहीं)'
    }
  };

  // Shorter, clearer wording overrides when Simple Language mode is ON
  const SIMPLE_OVERRIDES = {
    en: {
      hero_title: 'See a street problem? Tell us in 3 easy steps.',
      hero_desc: 'Report potholes, trash, broken lights, or water leaks. Track fixes on a live map.',
      emergency_body: 'Do not use this for emergencies. Call 112 or 100 if someone is in danger.',
      desc_placeholder: 'Write what is wrong and where it is (at least 20 letters)...',
      desc_help: 'Write at least 20 letters. Tell us if it is dangerous.',
      err_desc_short: 'Please write at least 20 letters.',
      anon_help: 'Other citizens will not see your name. City staff can still see it.',
      dup_support_hint: 'Someone already reported this? Support their report instead of making a new one.',
      exp_submitted: 'Sent. Staff will read it soon.',
      exp_under_review: 'Staff are checking your report.',
      exp_assigned: 'A team has been picked to fix this.',
      exp_in_progress: 'Workers are fixing this now.',
      exp_resolved: 'Staff say it is fixed. Citizens can check and confirm.',
      exp_closed: 'This report is finished and closed.',
      exp_reopened: 'Opened again because the problem is still there.'
    },
    hi: {
      hero_title: 'सड़क पर समस्या दिखी? 3 आसान चरणों में बताएं।',
      hero_desc: 'गड्ढे, कचरा, खराब लाइट या पानी रिसाव की रिपोर्ट करें और सुधार देखें।',
      emergency_body: 'आपातकाल में उपयोग न करें। खतरे में 112 या 100 पर कॉल करें।',
      desc_placeholder: 'क्या समस्या है और कहाँ है लिखें (कम से कम 20 अक्षर)...',
      desc_help: 'कम से कम 20 अक्षर लिखें। खतरा हो तो बताएं।',
      err_desc_short: 'कृपया कम से कम 20 अक्षर लिखें।',
      anon_help: 'बाकी लोगों को आपका नाम नहीं दिखेगा। स्टाफ देख सकेगा।',
      dup_support_hint: 'क्या यह पहले से दर्ज है? नई रिपोर्ट के बजाय पुरानी का समर्थन करें।',
      exp_submitted: 'भेजा गया। स्टाफ जल्द पढ़ेगा।',
      exp_under_review: 'स्टाफ आपकी रिपोर्ट जांच रहा है।',
      exp_assigned: 'काम के लिए टीम चुन ली गई है।',
      exp_in_progress: 'टीम अभी इसे ठीक कर रही है।',
      exp_resolved: 'स्टाफ ने इसे ठीक किया। नागरिक जांच कर सकते हैं।',
      exp_closed: 'यह रिपोर्ट पूरी होकर बंद है।',
      exp_reopened: 'समस्या बाकी होने से फिर खोली गई।'
    }
  };

  function getLang() {
    const saved = localStorage.getItem('civiq_lang');
    return saved === 'hi' ? 'hi' : 'en';
  }

  function setLang(lang) {
    const next = lang === 'hi' ? 'hi' : 'en';
    localStorage.setItem('civiq_lang', next);
    document.documentElement.setAttribute('lang', next);
    announce(next === 'hi' ? 'Language changed to Hindi (demonstration)' : 'Language changed to English');
  }

  function isSimple() {
    return localStorage.getItem('civiq_simple_lang') === '1';
  }

  function setSimple(enabled) {
    localStorage.setItem('civiq_simple_lang', enabled ? '1' : '0');
    announce(enabled ? 'Simple language mode enabled' : 'Simple language mode disabled');
  }

  function t(key) {
    const lang = getLang();
    if (isSimple() && SIMPLE_OVERRIDES[lang]?.[key]) {
      return SIMPLE_OVERRIDES[lang][key];
    }
    return STRINGS[lang]?.[key] || STRINGS.en[key] || key;
  }

  function catLabel(cat) {
    return t(`cat_${cat}`);
  }

  function statusLabel(st) {
    return t(`st_${st}`);
  }

  function statusExplain(st) {
    return t(`exp_${st}`);
  }

  function priorityLabel(pr) {
    return t(`pr_${pr}`);
  }

  function announce(msg) {
    const el = document.getElementById('sr-announcer');
    if (el) {
      el.textContent = '';
      setTimeout(() => { el.textContent = msg; }, 30);
    }
  }

  // Initialize <html lang> on load
  document.documentElement.setAttribute('lang', getLang());

  window.CivIQI18n = {
    getLang,
    setLang,
    isSimple,
    setSimple,
    t,
    catLabel,
    statusLabel,
    statusExplain,
    priorityLabel,
    announce
  };
})();
