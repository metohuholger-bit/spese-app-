// Lettura dello scontrino con Claude: la foto viene inviata all'API Anthropic
// usando la chiave salvata dall'utente su questo dispositivo.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { CATEGORIES, CATEGORY_IDS } from './categories.js';

const ReceiptSchema = z.object({
  leggibile: z.boolean().describe('false se la foto non è uno scontrino o il totale non si legge'),
  negozio: z.string().nullable().describe('Nome del negozio o esercente, breve'),
  totale: z.number().nullable().describe('Totale pagato in euro, es. 23.5'),
  data: z.string().nullable().describe('Data dello scontrino nel formato AAAA-MM-GG'),
  categoria: z.enum(CATEGORY_IDS),
});

const PROMPT = `Questa è la foto di uno scontrino o di una ricevuta, di solito italiana.
Estrai: il nome del negozio, il totale effettivamente pagato (la riga TOTALE / TOTALE COMPLESSIVO,
non i subtotali, il resto o l'importo in contanti consegnato), la data di emissione e la categoria
di spesa più adatta tra queste:
${CATEGORIES.map((c) => `- ${c.id}: ${c.label}`).join('\n')}

Le date italiane sono nel formato GG/MM/AAAA: convertile in AAAA-MM-GG.
Se un dato non si legge con sicurezza, restituisci null per quel campo invece di tirare a indovinare.`;

export class ReceiptError extends Error {}

/**
 * @param {string} apiKey
 * @param {string} jpegBase64 foto JPEG in base64 (senza prefisso data:)
 */
export async function readReceipt(apiKey, jpegBase64) {
  // L'app non ha un server: la chiamata parte dal browser con la chiave dell'utente.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  let response;
  try {
    response = await client.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
      output_config: { effort: 'low', format: zodOutputFormat(ReceiptSchema) },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new ReceiptError('Chiave API non valida. Controllala nelle impostazioni.');
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
      throw new ReceiptError('La chiave API non ha i permessi per questa richiesta.');
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new ReceiptError('Troppe richieste in poco tempo. Riprova tra qualche secondo.');
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new ReceiptError('Connessione assente. Inserisci i dati a mano o riprova.');
    }
    if (error instanceof Anthropic.APIError) {
      throw new ReceiptError(`Errore del servizio (${error.status ?? '?'}). Riprova più tardi.`);
    }
    throw error;
  }

  const data = response.parsed_output;
  if (response.stop_reason === 'refusal' || !data || !data.leggibile) {
    throw new ReceiptError('Non riesco a leggere lo scontrino. Inserisci i dati a mano.');
  }
  return data;
}
