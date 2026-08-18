"use strict";

// 前端模块化入口：仅负责装配各模块并启动。
// 模块布局见 ARCHITECTURE.md「前端模块化」一节。

import { $ } from "./js/core/dom.js";
import { t } from "./js/core/i18n.js";
import * as settings from "./js/dialogs/settings.js";
import * as resume from "./js/dialogs/resume.js";
import * as preview from "./js/dialogs/preview.js";
import * as compare from "./js/dialogs/compare.js";
import * as history from "./js/views/history.js";
import * as phone from "./js/views/phone.js";
import * as screening from "./js/views/screening.js";
import * as shell from "./shell.js";

settings.init();
resume.init();
preview.init();
compare.init();
history.init();
phone.init();
screening.init();
shell.init();

shell.applyStaticLanguage();
$("viewTitle").textContent = t("jobTitle");
shell.bootstrap();
