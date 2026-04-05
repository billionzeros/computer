/**
 * Lead Scanner eval dataset.
 *
 * Tests whether the lead-scanner agent correctly extracts lead data
 * from form submissions, handles edge cases, and deduplicates.
 *
 * Inputs simulate what the agent would see after scanning Gmail.
 * Expected fields verify extraction accuracy.
 */

import type { WorkflowEvalCase } from '../types.js'

export const leadScannerDataset = {
  name: 'workflow-lead-scanner',
  description:
    'Does the lead-scanner agent correctly extract and structure lead data from form submissions?',
  cases: [
    // ── Standard Typeform submission ────────────────────────────────
    {
      input:
        'You received a new form submission via email from Typeform:\n\n' +
        'Subject: New submission from Contact Form\n' +
        'Name: Sarah Chen\n' +
        'Email: sarah.chen@acmecorp.com\n' +
        'Company: Acme Corp\n' +
        'Title: VP of Engineering\n' +
        'Message: Interested in your platform for our 200-person engineering team.\n\n' +
        'Extract the lead data and prepare it for the sheet. Set status to "new".',
      expectedFields: {
        name: 'Sarah Chen',
        email: 'sarah.chen@acmecorp.com',
        company: 'Acme Corp',
        title: 'VP of Engineering',
        status: 'new',
      },
      tags: ['standard', 'typeform'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scanner',
    },

    // ── Webflow form with minimal info ─────────────────────────────
    {
      input:
        'You received a new form submission via email from Webflow:\n\n' +
        'Subject: New Webflow Form Submission\n' +
        'Email: j.martinez@startupxyz.io\n' +
        'Company: StartupXYZ\n' +
        'Message: Would love a demo.\n\n' +
        'Extract the lead data. Note: name and title are missing. Set status to "new".',
      expectedFields: {
        email: 'j.martinez@startupxyz.io',
        company: 'StartupXYZ',
        status: 'new',
      },
      tags: ['minimal', 'webflow', 'missing-fields'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scanner',
    },

    // ── Personal email address ──────────────────────────────────────
    {
      input:
        'You received a new form submission:\n\n' +
        'Name: Mike Thompson\n' +
        'Email: mikethompson92@gmail.com\n' +
        'Message: Saw your product on Twitter. Looks cool.\n\n' +
        'Extract the lead data. Note the personal email domain. Set status to "new".',
      expectedFields: {
        name: 'Mike Thompson',
        email: 'mikethompson92@gmail.com',
        status: 'new',
      },
      tags: ['personal-email', 'edge-case'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scanner',
    },

    // ── Multiple leads in one email ─────────────────────────────────
    {
      input:
        'You received a batch notification with 2 new form submissions:\n\n' +
        '--- Submission 1 ---\n' +
        'Name: Alex Rivera\n' +
        'Email: alex@bigcorp.com\n' +
        'Company: BigCorp\n' +
        'Title: Director of Product\n\n' +
        '--- Submission 2 ---\n' +
        'Name: Priya Sharma\n' +
        'Email: priya.sharma@techwave.io\n' +
        'Company: TechWave\n' +
        'Title: CTO\n\n' +
        'Extract both leads separately. Set status to "new" for each.',
      expectedFields: {
        name: 'Alex Rivera',
        email: 'alex@bigcorp.com',
        company: 'BigCorp',
        status: 'new',
      },
      tags: ['batch', 'multiple-leads'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scanner',
    },

    // ── Duplicate detection ─────────────────────────────────────────
    {
      input:
        'You received a new form submission:\n\n' +
        'Name: Sarah Chen\n' +
        'Email: sarah.chen@acmecorp.com\n' +
        'Company: Acme Corp\n' +
        'Message: Following up on my previous inquiry.\n\n' +
        'IMPORTANT: The sheet already contains a row with email sarah.chen@acmecorp.com (status: "scored").\n' +
        'Extract the lead data but flag this as a duplicate.',
      expected: 'duplicate',
      expectedFields: {
        email: 'sarah.chen@acmecorp.com',
      },
      tags: ['duplicate', 'dedup'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scanner',
    },

    // ── Non-lead email (noise filtering) ────────────────────────────
    {
      input:
        'You found an email in the inbox:\n\n' +
        'Subject: Your monthly Typeform analytics report\n' +
        'From: notifications@typeform.com\n' +
        'Body: Here is your monthly form analytics summary. You had 42 submissions this month...\n\n' +
        'Determine if this contains a lead submission. If not, skip it.',
      expected: 'skip',
      tags: ['noise', 'non-lead'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scanner',
    },

    // ── Rich form with all fields ──────────────────────────────────
    {
      input:
        'You received a detailed form submission:\n\n' +
        'Name: David Kim\n' +
        'Email: david.kim@enterprise.co\n' +
        'Company: Enterprise Solutions Inc\n' +
        'Title: Head of Infrastructure\n' +
        'Team Size: 500+\n' +
        'Budget: $50k-$100k\n' +
        'Timeline: Q2 2026\n' +
        'Source: Google Search\n' +
        'Message: We need a solution for automated lead management across 3 regions.\n\n' +
        'Extract the lead data. Set status to "new".',
      expectedFields: {
        name: 'David Kim',
        email: 'david.kim@enterprise.co',
        company: 'Enterprise Solutions Inc',
        title: 'Head of Infrastructure',
        status: 'new',
        source: 'Google Search',
      },
      tags: ['rich', 'all-fields'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scanner',
    },

    // ── Malformed email / garbled content ───────────────────────────
    {
      input:
        'You received a form submission with some garbled content:\n\n' +
        'Name: ???\n' +
        'Email: li.wei@huawei-tech.cn\n' +
        'Company: \n' +
        'Title: 产品经理\n' +
        'Message: Looking for API integration capabilities.\n\n' +
        'Extract what you can. Set status to "new".',
      expectedFields: {
        email: 'li.wei@huawei-tech.cn',
        status: 'new',
      },
      tags: ['malformed', 'edge-case', 'i18n'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scanner',
    },

    // ── Role-based email (info@, support@) ─────────────────────────
    {
      input:
        'You received a form submission:\n\n' +
        'Name: Unknown\n' +
        'Email: info@smallbiz.com\n' +
        'Company: SmallBiz LLC\n' +
        'Message: Please send us pricing information.\n\n' +
        'Extract the lead data. Note this is a role-based email address. Set status to "new".',
      expectedFields: {
        email: 'info@smallbiz.com',
        company: 'SmallBiz LLC',
        status: 'new',
      },
      tags: ['role-email', 'edge-case'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scanner',
    },
  ] as WorkflowEvalCase[],
}
