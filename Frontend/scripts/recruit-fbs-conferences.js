/**
 * @deprecated Use scripts/fbs-conferences.js
 */
(function (global) {
  if (global.FbsConferences) {
    global.RecruitFbsConferences = {
      load: global.FbsConferences.load,
      conferenceForTeam: global.FbsConferences.conferenceForSchool,
    };
    return;
  }
  const s = document.createElement("script");
  s.src = "scripts/fbs-conferences.js";
  s.onload = function () {
    global.RecruitFbsConferences = {
      load: global.FbsConferences.load,
      conferenceForTeam: global.FbsConferences.conferenceForSchool,
    };
  };
  document.head.appendChild(s);
})(window);
