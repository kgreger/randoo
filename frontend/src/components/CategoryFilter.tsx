import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { CATEGORIES, GROUPS, groupState, type GroupDef } from "../lib/categories";

interface Props {
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleGroup: (groupId: string) => void;
  radiusM: number;
  onRadiusChange: (value: number) => void;
  /** Only for a signed-in rider: keep the current selection as the one every
   * search starts with. */
  defaults?: {
    hasSaved: boolean;
    status: "idle" | "saved" | "reset" | "error";
    onSave: () => void;
    onReset: () => void;
  };
}

export function CategoryFilter({ selected, onToggle, onToggleGroup, radiusM, onRadiusChange, defaults }: Props) {
  const { t } = useTranslation();
  const active = selected.size;
  const total = CATEGORIES.length;
  // Groups with something selected start open, so the rider sees what a
  // search will look for; the rest stay folded.
  const [open, setOpen] = useState(
    () => new Set(GROUPS.filter((group) => group.categories.some((c) => selected.has(c.id))).map((g) => g.id)),
  );

  function toggleOpen(groupId: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  return (
    <>
      <div>
        <div className="section-label category-heading">
          <span>{t("categories.sectionLabel")}</span>
          <span
            className="category-count"
            title={t("categories.selectedCount", { active, total })}
            aria-label={t("categories.selectedCount", { active, total })}
          >
            {active}/{total}
          </span>
        </div>
        <div className="category-tree">
          {GROUPS.map((group) => (
            <CategoryGroup
              key={group.id}
              group={group}
              selected={selected}
              expanded={open.has(group.id)}
              onExpand={() => toggleOpen(group.id)}
              onToggle={onToggle}
              onToggleGroup={() => onToggleGroup(group.id)}
            />
          ))}
        </div>
        {defaults && (
          <div className="category-defaults">
            <button type="button" className="link-button" onClick={defaults.onSave}>
              {t("categories.saveAsDefault")}
            </button>
            {defaults.hasSaved && (
              <button type="button" className="link-button" onClick={defaults.onReset}>
                {t("categories.resetDefault")}
              </button>
            )}
            {defaults.status === "saved" && <span className="account-success">{t("categories.defaultSaved")}</span>}
            {defaults.status === "reset" && <span className="account-success">{t("categories.defaultReset")}</span>}
            {defaults.status === "error" && <span className="account-error">{t("categories.defaultError")}</span>}
          </div>
        )}
      </div>
      <div className="radius-row">
        <label>
          <span>{t("categories.radius")}</span>
          <span className="value">{t("categories.radiusValue", { value: radiusM })}</span>
        </label>
        <input
          type="range"
          min={100}
          max={2000}
          step={100}
          value={radiusM}
          onChange={(e) => onRadiusChange(Number(e.target.value))}
        />
      </div>
    </>
  );
}

interface GroupProps {
  group: GroupDef;
  selected: ReadonlySet<string>;
  expanded: boolean;
  onExpand: () => void;
  onToggle: (id: string) => void;
  onToggleGroup: () => void;
}

function CategoryGroup({ group, selected, expanded, onExpand, onToggle, onToggleGroup }: GroupProps) {
  const { t } = useTranslation();
  const state = groupState(group, selected);
  const count = group.categories.filter((c) => selected.has(c.id)).length;
  const checkboxRef = useRef<HTMLInputElement>(null);
  const Icon = group.icon;
  const label = t(`categoryGroups.${group.id}`);

  // "Some of it" has no HTML attribute, only this property.
  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = state === "some";
  }, [state]);

  return (
    <div className={`category-group ${state !== "none" ? "has-selection" : ""}`}>
      <div className="category-group-head">
        <input
          ref={checkboxRef}
          type="checkbox"
          className="category-group-check"
          checked={state === "all"}
          onChange={onToggleGroup}
          aria-label={t("categories.selectGroup", { group: label })}
        />
        <button
          type="button"
          className="category-group-toggle"
          onClick={onExpand}
          aria-expanded={expanded}
          aria-controls={`category-group-${group.id}`}
        >
          <Icon size={16} strokeWidth={2} aria-hidden="true" />
          <span className="category-group-label">{label}</span>
          <span className="category-group-count">
            {count}/{group.categories.length}
          </span>
          <ChevronDown size={16} strokeWidth={2} className="category-group-chevron" aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div className="chip-row category-group-body" id={`category-group-${group.id}`}>
          {group.categories.map((category) => {
            const CategoryIcon = category.icon;
            return (
              <button
                key={category.id}
                type="button"
                className={`chip ${selected.has(category.id) ? "active" : ""}`}
                aria-pressed={selected.has(category.id)}
                onClick={() => onToggle(category.id)}
              >
                <CategoryIcon size={13} strokeWidth={2} aria-hidden="true" />
                {t(`categories.${category.id}`)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
