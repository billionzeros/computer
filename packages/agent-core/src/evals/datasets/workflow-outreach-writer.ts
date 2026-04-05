/**
 * Outreach Writer eval dataset.
 *
 * Tests whether the outreach-writer agent produces personalized,
 * high-quality emails based on scored lead profiles.
 *
 * Inputs provide scored leads with research context.
 * Quality criteria define what a good email looks like.
 */

import type { WorkflowEvalCase } from '../types.js'

export const outreachWriterDataset = {
  name: 'workflow-outreach-writer',
  description:
    'Does the outreach-writer agent produce personalized, relevant, high-quality outreach emails?',
  cases: [
    // ── Hot lead: inbound warm pattern ──────────────────────────────
    {
      input:
        'Write an outreach email for this scored lead:\n\n' +
        'Name: Sarah Chen\n' +
        'Email: sarah.chen@acmecorp.com\n' +
        'Company: Acme Corp\n' +
        'Title: VP of Engineering\n' +
        'Score: 92 (hot)\n\n' +
        'Research notes:\n' +
        '- B2B SaaS, 200 employees, project management tools\n' +
        '- Just raised Series B ($30M)\n' +
        '- Source: Demo request form — she asked about API integration\n' +
        '- Tech stack: React, Node.js, AWS\n\n' +
        'Use the Inbound Warm email pattern. Acknowledge her demo request.\n' +
        'Our product: AI-powered lead qualification platform.\n' +
        'Sender name: Alex from Anton.',
      qualityCriteria: [
        'References her demo request specifically',
        'Mentions Acme Corp or her company by name',
        'Mentions API integration (her stated interest)',
        'Has a clear, low-pressure CTA (book a call, reply)',
        'Subject line is specific and under 50 characters',
        'Body is under 100 words',
        'No generic filler like "hope this finds you well"',
      ],
      tags: ['hot', 'inbound-warm'],
      workflowId: 'lead-qualification',
      agentKey: 'outreach-writer',
    },

    // ── Warm lead: research-based pattern ──────────────────────────
    {
      input:
        'Write an outreach email for this scored lead:\n\n' +
        'Name: Carlos Mendez\n' +
        'Email: carlos@fintechpay.com\n' +
        'Company: FintechPay\n' +
        'Title: VP of Product\n' +
        'Score: 72 (warm)\n\n' +
        'Research notes:\n' +
        '- Fintech, 400 employees\n' +
        '- Just closed Series C ($80M), expanding engineering 2x\n' +
        '- Carlos published a blog post about "scaling product teams"\n' +
        '- Active on LinkedIn discussing AI in fintech\n\n' +
        'Use the Research-Based email pattern. Lead with intel about their growth.\n' +
        'Our product: AI-powered lead qualification platform.\n' +
        'Sender name: Alex from Anton.',
      qualityCriteria: [
        'References their Series C or growth specifically',
        'Mentions his blog post or LinkedIn activity',
        'Connects their scaling challenge to our product',
        'Has a clear CTA',
        'Subject line is specific, not generic',
        'Body is under 100 words',
        'Tone is professional but not stiff',
      ],
      tags: ['warm', 'research-based'],
      workflowId: 'lead-qualification',
      agentKey: 'outreach-writer',
    },

    // ── Hot lead: pain-point pattern ───────────────────────────────
    {
      input:
        'Write an outreach email for this scored lead:\n\n' +
        'Name: Priya Sharma\n' +
        'Email: priya@techwave.io\n' +
        'Company: TechWave\n' +
        'Title: CTO\n' +
        'Score: 88 (hot)\n\n' +
        'Research notes:\n' +
        '- B2B SaaS developer tools, 100 employees\n' +
        '- Hiring 10 engineers (posted on LinkedIn)\n' +
        '- 2nd form submission (high intent)\n' +
        '- First message mentioned "wasting time on unqualified leads"\n' +
        '- Tech stack: TypeScript, Kubernetes\n\n' +
        'Use the Pain-Point email pattern. Lead with her stated pain about unqualified leads.\n' +
        'Our product: AI-powered lead qualification platform.\n' +
        'Sender name: Alex from Anton.',
      qualityCriteria: [
        'References her pain point about unqualified leads',
        'Mentions TechWave by name',
        'Acknowledges her repeat interest',
        'Has a clear, low-pressure CTA',
        'Subject line references the pain point',
        'Body is under 100 words',
        'First sentence is about HER, not us',
      ],
      tags: ['hot', 'pain-point', 'repeat-submission'],
      workflowId: 'lead-qualification',
      agentKey: 'outreach-writer',
    },

    // ── Warm lead: content-based pattern ───────────────────────────
    {
      input:
        'Write an outreach email for this scored lead:\n\n' +
        'Name: James Wilson\n' +
        'Email: jwilson@midmarket.com\n' +
        'Company: MidMarket Solutions\n' +
        'Title: Director of Engineering\n' +
        'Score: 66 (warm)\n\n' +
        'Research notes:\n' +
        '- B2B SaaS analytics, 150 employees\n' +
        '- James recently published "Building a scalable sales pipeline" on Medium\n' +
        '- Company blog has articles about GTM efficiency\n' +
        '- Source: Downloaded our whitepaper on lead scoring\n\n' +
        'Use the Content-Based email pattern. Reference his published content.\n' +
        'Our product: AI-powered lead qualification platform.\n' +
        'Sender name: Alex from Anton.',
      qualityCriteria: [
        'References his Medium article by topic',
        'Connects his content interest to our product',
        'Mentions the whitepaper download',
        'Has a clear CTA',
        'Subject line is relevant to his content',
        'Body is under 100 words',
        'Does not sound like a template',
      ],
      tags: ['warm', 'content-based'],
      workflowId: 'lead-qualification',
      agentKey: 'outreach-writer',
    },

    // ── Event-based pattern ────────────────────────────────────────
    {
      input:
        'Write an outreach email for this scored lead:\n\n' +
        'Name: Robert Chang\n' +
        'Email: robert.chang@megacorp.com\n' +
        'Company: MegaCorp International\n' +
        'Title: Senior Director, Platform Engineering\n' +
        'Score: 70 (warm)\n\n' +
        'Research notes:\n' +
        '- Enterprise software, 15,000 employees\n' +
        '- Just announced a major digital transformation initiative\n' +
        '- Referred by existing customer (DataFlow Inc)\n' +
        '- Company in the news for acquiring AI startup\n\n' +
        'Use the Event-Based email pattern. Congratulate on their digital transformation.\n' +
        'Our product: AI-powered lead qualification platform.\n' +
        'Sender name: Alex from Anton.',
      qualityCriteria: [
        'References the digital transformation initiative',
        'Mentions the referral from DataFlow Inc',
        'Acknowledges MegaCorp by name',
        'Has a clear CTA appropriate for enterprise',
        'Subject line references the event/news',
        'Body is under 100 words',
        'Tone is appropriately formal for enterprise',
      ],
      tags: ['warm', 'event-based', 'enterprise', 'referral'],
      workflowId: 'lead-qualification',
      agentKey: 'outreach-writer',
    },

    // ── Edge case: minimal research data ───────────────────────────
    {
      input:
        'Write an outreach email for this scored lead:\n\n' +
        'Name: Li Wei\n' +
        'Email: li.wei@huawei-tech.cn\n' +
        'Company: (extracted from domain: huawei-tech.cn)\n' +
        'Title: Unknown\n' +
        'Score: 62 (warm)\n\n' +
        'Research notes:\n' +
        '- Minimal info available\n' +
        '- Domain suggests tech company\n' +
        '- Source: Contact form, message about "API integration"\n' +
        '- No LinkedIn profile found\n\n' +
        'Write a personalized email despite limited data. Focus on their stated interest.\n' +
        'Our product: AI-powered lead qualification platform.\n' +
        'Sender name: Alex from Anton.',
      qualityCriteria: [
        'References their API integration interest',
        'Does not fake knowledge about the person',
        'Has a clear CTA',
        'Subject line is not generic',
        'Body is under 100 words',
        'Handles missing info gracefully',
      ],
      tags: ['warm', 'minimal-data', 'edge-case'],
      workflowId: 'lead-qualification',
      agentKey: 'outreach-writer',
    },
  ] as WorkflowEvalCase[],
}
