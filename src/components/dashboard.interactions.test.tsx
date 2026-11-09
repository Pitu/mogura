import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { Window } from 'happy-dom'
import { demoData } from '../lib/demo'
import type { DashboardData, ServicePublishResult } from '../lib/types'
import type { ServiceInput } from '../lib/validation'

const data: DashboardData = { ...structuredClone(demoData), mode: 'live', accountId: 'a'.repeat(32), source: 'storage' }
const publishService = mock(async (_request: { data: ServiceInput }): Promise<ServicePublishResult> => ({ status: 'published', applicationId: '00000000-0000-4000-8000-000000000099' }))
mock.module('../lib/functions', () => ({ getDashboard: async () => data, publishService }))

let page: Window
let root: Root
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLDialogElement', 'FormData', 'Event', 'KeyboardEvent', 'IS_REACT_ACT_ENVIRONMENT']
const originalGlobals = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))

beforeEach(async () => {
  page = new Window({ url: 'http://localhost:3000', width: 390, height: 844 })
  for (const name of globals) {
    const value = name === 'window' ? page : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : Reflect.get(page, name)
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  publishService.mockClear()
})

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  await page.happyDOM.close()
})

afterAll(() => {
  for (const name of globals) {
    const descriptor = originalGlobals.get(name)
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

async function renderDashboard() {
  const { createRoot } = await import('react-dom/client')
  const { Dashboard } = await import('./dashboard')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<Dashboard initialData={data} initialError="" view="tunnels" onViewChange={() => {}} />))
  // Happy DOM initializes media listener history to false; seed the current
  // viewport before testing subsequent crossings of the breakpoint.
  await act(async () => { page.dispatchEvent(new page.Event('resize')) })
}

function element<T extends HTMLElement>(selector: string) {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Missing test element: ${selector}`)
  return found
}

async function click(selector: string) { await act(async () => element(selector).click()) }

async function fill(selector: string, value: string) {
  const input = element<HTMLInputElement>(selector)
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setValue?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('the mobile drawer hides its focus targets, traps focus while open, and restores the opener', async () => {
  await renderDashboard()
  const sidebar = element('aside.sidebar')
  const main = element('.main-shell')
  const toggle = element<HTMLButtonElement>('[aria-controls="workspace-navigation"]')
  expect(sidebar.hasAttribute('inert')).toBe(true)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  toggle.focus()
  await click('[aria-controls="workspace-navigation"]')
  expect(sidebar.hasAttribute('inert')).toBe(false)
  expect(main.hasAttribute('inert')).toBe(true)
  expect(sidebar.contains(document.activeElement)).toBe(true)
  const last = sidebar.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')
  last[last.length - 1].focus()
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })) })
  expect(document.activeElement).toBe(last[0])
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(sidebar.hasAttribute('inert')).toBe(true)
  expect(main.hasAttribute('inert')).toBe(false)
  expect(document.activeElement).toBe(toggle)
  expect(document.body.style.overflow).toBe('')
})

test('narrow screens default to List and an explicit preference survives resize and remount', async () => {
  await renderDashboard()
  expect(element('[aria-label="List view"]').getAttribute('aria-pressed')).toBe('true')
  expect(document.querySelector('.canvas')).toBeNull()
  await act(async () => page.happyDOM.setWindowSize({ width: 1440, height: 1000 }))
  expect(element('[aria-label="Canvas view"]').getAttribute('aria-pressed')).toBe('true')
  await click('[aria-label="List view"]')
  expect(localStorageValue()).toBe('list')
  await act(async () => page.happyDOM.setWindowSize({ width: 390, height: 844 }))
  await click('[aria-label="Canvas view"]')
  expect(localStorageValue()).toBe('map')
  await act(async () => root.unmount())
  await renderDashboard()
  expect(element('[aria-label="Canvas view"]').getAttribute('aria-pressed')).toBe('true')
})

function localStorageValue() { return page.localStorage.getItem('tunnel.route-layout') }

test('policy order and partial publication survive closing and reopening the service form', async () => {
  const applicationId = '00000000-0000-4000-8000-000000000099'
  publishService.mockResolvedValueOnce({ status: 'application_only', applicationId, error: 'Origin route failed. Retry publishing.' })
  await renderDashboard()
  await click('.heading-actions .button.primary')
  await fill('input[name="name"]', 'Photos')
  await fill('input[name="service"]', 'http://localhost:2283')
  await click('.policy-option:nth-child(3) input')
  await click('.policy-option:nth-child(1) input')
  const orderedNames = () => Array.from(document.querySelectorAll('.selected-policy-order li'), (item) => item.textContent)
  expect(orderedNames()).toEqual(['Service tokens', 'Only me'])
  await act(async () => element('form.resource-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(publishService).toHaveBeenCalledTimes(1)
  expect(element('.resume-banner').textContent).toContain('Photos')
  await click('dialog [aria-label="Close dialog"]')
  expect(document.querySelector('dialog')).toBeNull()
  await click('.resume-banner .button')
  expect(element<HTMLInputElement>('input[name="name"]').value).toBe('Photos')
  expect(element<HTMLInputElement>('input[name="name"]').disabled || element('input[name="name"]').closest('fieldset')?.hasAttribute('disabled')).toBe(true)
  expect(element<HTMLInputElement>('input[name="service"]').value).toBe('http://localhost:2283')
  expect(orderedNames()).toEqual(['Service tokens', 'Only me'])
  expect(element('dialog').textContent).toContain('Retry route')
  await act(async () => element('form.resource-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(publishService).toHaveBeenCalledTimes(2)
  expect(publishService.mock.calls[1][0].data.applicationId).toBe(applicationId)
  expect(publishService.mock.calls[1][0].data.policyIds).toEqual([data.policies[2].id, data.policies[0].id])
  expect(document.querySelector('.resume-banner')).toBeNull()
  expect(document.querySelector('dialog')).toBeNull()
})
