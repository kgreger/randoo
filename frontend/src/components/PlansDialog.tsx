import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { deletePlan, listPlans, loadPlan, type LoadedPlan, type PlanSummary } from "../lib/plans";

interface Props {
  onOpen: (plan: LoadedPlan) => void;
  onDeleted: (plan: PlanSummary, routeRemoved: boolean) => void;
  onClose: () => void;
}

export function PlansDialog({ onOpen, onDeleted, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    listPlans()
      .then(setPlans)
      .catch(() => setError(t("plans.errorLoad")));
  }, [t]);

  async function open(plan: PlanSummary) {
    setBusyId(plan.id);
    setError(null);
    try {
      onOpen(await loadPlan(plan.id));
    } catch {
      setBusyId(null);
      setError(t("plans.errorLoad"));
    }
  }

  async function remove(plan: PlanSummary) {
    setBusyId(plan.id);
    setError(null);
    try {
      const routeRemoved = await deletePlan(plan);
      setPlans((prev) => prev?.filter((p) => p.id !== plan.id) ?? null);
      setConfirmId(null);
      onDeleted(plan, routeRemoved);
    } catch {
      setError(t("plans.errorDelete"));
    }
    setBusyId(null);
  }

  // Plans arrive newest first; each route is listed where its newest plan is.
  const groups: { route: PlanSummary["route"]; plans: PlanSummary[] }[] = [];
  for (const plan of plans ?? []) {
    const group = groups.find((g) => g.route.id === plan.route.id);
    if (group) group.plans.push(plan);
    else groups.push({ route: plan.route, plans: [plan] });
  }

  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });

  return (
    <div className="map-empty">
      <div className="map-empty-card signin-card plans-card">
        <button className="dialog-close" onClick={onClose} aria-label={t("account.close")}>
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>

        <h2 className="plans-title">{t("plans.title")}</h2>

        <div className="plans-scroll">
        {plans === null && !error && <p className="account-hint">{t("plans.loading")}</p>}
        {plans !== null && plans.length === 0 && <p className="account-hint">{t("plans.empty")}</p>}
        {error && <p className="account-error">{error}</p>}

        {groups.map(({ route, plans: routePlans }) => (
          <div className="plans-group" key={route.id}>
            <div className="plans-route">
              <span className="plans-route-name">{route.name}</span>
              {route.distance_m !== null && (
                <span className="plans-route-km">{t("app.distanceKm", { km: (route.distance_m / 1000).toFixed(1) })}</span>
              )}
            </div>
            {routePlans.map((plan) => (
              <div className="plans-item" key={plan.id}>
                <button className="plans-open" onClick={() => open(plan)} disabled={busyId !== null}>
                  <span className="plans-item-name">{plan.name}</span>
                  <span className="plans-item-meta">
                    {t("plans.meta", { count: plan.poi_count })} · {dateFormat.format(new Date(plan.updated_at))}
                  </span>
                </button>
                {confirmId === plan.id ? (
                  <button className="btn btn-ghost-danger plans-confirm" onClick={() => remove(plan)} disabled={busyId !== null}>
                    {t("plans.confirmDelete")}
                  </button>
                ) : (
                  <button
                    className="plans-delete"
                    onClick={() => setConfirmId(plan.id)}
                    aria-label={t("plans.delete")}
                    disabled={busyId !== null}
                  >
                    <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}
