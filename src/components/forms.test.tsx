import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { demoData } from '../lib/demo'
import { ResourceForm } from './forms'

test('the service form shares hostname fields and defaults to the first account zone', () => {
  const data = { ...demoData, zones: [...demoData.zones].reverse() }
  const html = renderToStaticMarkup(<ResourceForm kind="service" data={data} onSubmit={async () => {}} onCancel={() => {}} pending={false} />)
  for (const label of ['Application name', 'Subdomain', 'Domain', 'Path', 'ACCESS POLICIES', 'Tunnel', 'Reuse subdomain, domain, and path', 'Service URL']) expect(html).toContain(label)
  expect(html).toContain('<option value="example.net" selected="">')
  expect(html.match(/<select/g)).toHaveLength(2)
  expect(html.match(/checked=""/g)).toHaveLength(2)
})

test('standalone applications use the first zone but retain explicit hostname prefills', () => {
  const initial = renderToStaticMarkup(<ResourceForm kind="application" data={{ ...demoData, zones: [...demoData.zones].reverse() }} onSubmit={async () => {}} onCancel={() => {}} pending={false} />)
  expect(initial).toContain('<option value="example.net" selected="">')
  const prefilled = renderToStaticMarkup(<ResourceForm kind="application" data={demoData} initialHostname="preview.example.net" onSubmit={async () => {}} onCancel={() => {}} pending={false} />)
  expect(prefilled).toContain('<option value="example.net" selected="">')
  expect(prefilled).toContain('value="preview"')
})
