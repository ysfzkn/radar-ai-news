import { html } from "hono/html";
import { COPY, fieldLabel } from "../copy";
import { RISK_FLAGS } from "../schema";
import type { View } from "./layout";

// One review reason as the screen shows it. `raw` is true when `text` is the agent's own
// (English) wording, false when it is Turkish copy.
export interface ReasonView {
  kind: "verify" | "risk" | "other";
  label: string;
  text: string;
  raw: boolean;
}

const RISK = /^risk:\s*/;
const VERIFY = /^verify:\s*/;
const PATH = /^([a-z]+)\.([a-z_]+):\s*/;
const TOO_LONG = /^([a-z]+)\.([a-z_]+): too long \((\d+) > (\d+)\)$/;

const LINK = /^link or domain '(.*)'$/;
const BACKTICKS = /^backticks$/;
const COMMAND = /^command-like text '(.*)'$/;
const FOREIGN_TRY = /^fact_card\.try_url: host '(.*)' is not a source host$/;
const FACT_WHAT = /^fact_card\.what:\s*/;

// The injection checks' wording after the path, in Turkish; undefined for anything else.
function injectionText(where: string, tail: string): string | undefined {
  const link = LINK.exec(tail);
  if (link) return COPY.hasLinkReason(where, link[1]!);
  if (BACKTICKS.test(tail)) return COPY.hasBackticksReason(where);
  const command = COMMAND.exec(tail);
  if (command) return COPY.hasCommandReason(where, command[1]!);
  return undefined;
}

// "tr.title" -> "Türkçe başlık" when both parts are known; otherwise undefined.
function knownLabel(lang: string, field: string): string | undefined {
  if (lang !== "tr" && lang !== "en") return undefined;
  if (!Object.hasOwn(COPY.fieldName, field)) return undefined;
  return fieldLabel(`${lang}.${field}`);
}

const isRiskFlag = (value: string): value is (typeof RISK_FLAGS)[number] =>
  (RISK_FLAGS as readonly string[]).includes(value);

// The agent writes reasons as free strings; the shapes it is known to use become Turkish,
// anything else (a known prefix with nothing after it too) is shown as written. Never throws.
export function reasonView(reason: string): ReasonView {
  const other: ReasonView = { kind: "other", label: COPY.reasonKinds.other, text: reason, raw: true };
  if (RISK.test(reason)) {
    const flag = reason.replace(RISK, "").trim();
    if (flag === "") return other;
    const label = COPY.reasonKinds.risk;
    return isRiskFlag(flag)
      ? { kind: "risk", label, text: COPY.riskFlags[flag], raw: false }
      : { kind: "risk", label, text: flag, raw: true };
  }
  if (VERIFY.test(reason)) {
    const rest = reason.replace(VERIFY, "").trim();
    if (rest === "") return other;
    const label = COPY.reasonKinds.verify;
    const long = TOO_LONG.exec(rest);
    const longLabel = long ? knownLabel(long[1]!, long[2]!) : undefined;
    if (long && longLabel) {
      return { kind: "verify", label, text: COPY.tooLongReason(longLabel, long[3]!, long[4]!), raw: false };
    }
    const foreign = FOREIGN_TRY.exec(rest);
    if (foreign) return { kind: "verify", label, text: COPY.foreignTryHostReason(foreign[1]!), raw: false };
    const path = PATH.exec(rest);
    const pathLabel = path ? knownLabel(path[1]!, path[2]!) : undefined;
    const fact = FACT_WHAT.exec(rest);
    const where = path && pathLabel ? pathLabel : fact ? COPY.factCard : undefined;
    const tail = path && pathLabel ? rest.slice(path[0].length) : fact ? rest.slice(fact[0].length) : "";
    const injection = where ? injectionText(where, tail) : undefined;
    if (injection) return { kind: "verify", label, text: injection, raw: false };
    const text = path && pathLabel ? `${pathLabel}: ${rest.slice(path[0].length)}` : rest;
    return { kind: "verify", label, text, raw: true };
  }
  return other;
}

const KIND_CLASS: Record<ReasonView["kind"], string> = { risk: "chip risk", verify: "chip verify", other: "chip" };

// The reasons as a list: a kind chip, then the text (marked English when it is the agent's own).
export function reasonList(reasons: string[]): View {
  const items = reasons.map((r) => {
    const v = reasonView(r);
    const text = v.raw
      ? html`<span class="reason-text" lang="en">${v.text}</span>`
      : html`<span class="reason-text">${v.text}</span>`;
    return html`<li><span class="${KIND_CLASS[v.kind]}">${v.label}</span> ${text}</li>`;
  });
  return html`<ul class="reasons">${items}</ul>`;
}
