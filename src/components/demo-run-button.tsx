'use client';

// One click per scenario step: set the demo date (D-030), then open where the card starts, or stay
// and refresh when there is no page to open (D-058). With a preset it also does what the item
// page's buttons would (re-list, Get my quote) and opens the quote filled in (D-059). The server
// validates the date and every request as always.
import { useState } from 'react';
import { StatusMessage, useAsOf } from '@/components/as-of-control';
import type { AssetCondition } from '@/data/schemas';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { refusalText } from '@/i18n/refusals';

/** What to send after the date is set: the same requests as the item page's buttons. */
export type DemoPrepare = {
  assetId: string;
  /** Only while the item is still returned: a second run finds it re-listed already. */
  relist?: AssetCondition;
  quote: { termMonths: number; downPaymentCents: number };
  /** `<card>-<step>`, so the quote page fills in the card's application. */
  demo: string;
};

export function DemoRunButton({
  locale,
  asOf,
  href,
  prepare,
  label,
  variant = 'primary',
}: {
  locale: Locale;
  asOf: string;
  /** Where to go once the date is set; without it the current page refreshes. */
  href?: string;
  /** Make the quote and open it instead of `href`. */
  prepare?: DemoPrepare;
  label: string;
  variant?: 'primary' | 'ghost';
}) {
  const t = getT(locale);
  // The code the server refused a preset request with picks the message (D-038).
  const [refusal, setRefusal] = useState<{ code: string | undefined } | null>(null);

  async function run(steps: DemoPrepare) {
    if (steps.relist) {
      const relisted = await post(`/api/assets/${steps.assetId}/relist`, {
        target: steps.relist,
      });
      if (!relisted.ok) {
        setRefusal({ code: relisted.code });
        return;
      }
    }
    const quote = await post('/api/quotes', { assetId: steps.assetId, ...steps.quote });
    if (!quote.ok) {
      setRefusal({ code: quote.code });
      return;
    }
    window.location.assign(`/${locale}/quotes/${quote.id}?demo=${steps.demo}`);
  }

  // A full page load, not router.push: the layout (demo-date banner, header date) must re-render
  // with the new date too, and a client-side push keeps the old layout.
  const { status, set } = useAsOf(
    prepare ? () => void run(prepare) : href ? () => window.location.assign(href) : undefined
  );
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className={variant === 'primary' ? 'btn-primary px-4 py-1.5' : 'btn-ghost px-3 py-1.5'}
        // Busy stays on while the page loads; a refused preset lets the judge try again.
        disabled={status === 'busy' && refusal === null}
        onClick={() => {
          setRefusal(null);
          void set(asOf);
        }}
      >
        {label}
      </button>
      <StatusMessage status={status} locale={locale} />
      {refusal ? (
        <p role="alert" className="max-w-xs text-sm font-medium text-danger">
          {refusalText(t, refusal.code, 'quote.saveError')}
        </p>
      ) : null}
    </span>
  );
}

async function post(
  url: string,
  body: unknown
): Promise<{ ok: true; id: number | undefined } | { ok: false; code: string | undefined }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  const json = (await response?.json().catch(() => null)) as {
    success: boolean;
    data?: { id?: number };
    error?: { code: string };
  } | null;
  return json?.success ? { ok: true, id: json.data?.id } : { ok: false, code: json?.error?.code };
}
