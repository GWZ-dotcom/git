import { Fragment, useEffect, useMemo, useState } from 'react'
import './App.css'

const navItems = [
  { id: 'dashboard', label: 'Visão geral', icon: 'M3 3h8v8H3z M13 3h8v5h-8z M13 10h8v11h-8z M3 13h8v8H3z' },
  { id: 'ordens', label: 'Ordens de serviço', icon: 'M8 4h8 M8 8h8 M8 12h5 M5 3h14v18H5z' },
  { id: 'historico', label: 'Histórico de OS', icon: 'M3 12a9 9 0 1 0 3-6.7 M3 3v4h4 M12 7v5l3 2' },
  { id: 'clientes', label: 'Clientes', icon: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75' },
  { id: 'aparelhos', label: 'Aparelhos', icon: 'M7 2h10v20H7z M11 18h2' },
  { id: 'estoque', label: 'Estoque', icon: 'm3 7 9-4 9 4-9 4z M3 7v10l9 4 9-4V7 M12 11v10' },
  { id: 'vendas', label: 'Vendas e caixa', icon: 'M4 3h16v18l-3-2-3 2-3-2-3 2-4-2z M8 8h8 M8 12h8 M8 16h4' },
  { id: 'financeiro', label: 'Financeiro', icon: 'M4 19V5 M4 19h17 M8 15l4-5 3 2 5-7' },
]

const navGroups = [
  { label: 'PRINCIPAL', ids: ['dashboard', 'ordens', 'historico', 'clientes', 'aparelhos'] },
  { label: 'LOJA', ids: ['estoque', 'vendas', 'financeiro'] },
]

const pageTitles = {
  dashboard: 'Visão geral',
  clientes: 'Clientes',
  aparelhos: 'Aparelhos',
  ordens: 'Ordens de serviço',
  historico: 'Histórico de OS',
  conta: 'Minha conta',
  estoque: 'Estoque',
  vendas: 'Vendas e caixa',
  financeiro: 'Financeiro',
}

const pageDescriptions = {
  dashboard: 'Tudo o que acontece na sua assistência, em um só lugar.',
  clientes: 'Encontre e acompanhe quem confia seus aparelhos à sua assistência.',
  aparelhos: 'Consulte os aparelhos registrados e seus proprietários.',
  ordens: 'Acompanhe cada conserto do recebimento à entrega.',
  historico: 'Consulte as ordens confirmadas como pagas e finalizadas.',
  conta: 'Gerencie sua senha e o acesso ao aplicativo.',
  estoque: 'Peças e produtos organizados para você saber o que precisa repor.',
  vendas: 'Registre vendas e acompanhe as movimentações do caixa.',
  financeiro: 'Tenha clareza sobre receitas, despesas e resultado.',
}

const statusOptions = [
  'Recebido',
  'Em análise',
  'Aguardando aprovação do orçamento',
  'Aguardando peças',
  'Em manutenção',
  'Em testes',
  'Pronto para retirada',
  'Entregue ao cliente',
  'Cancelado',
]

const whatsappUpdateStatuses = [
  'Aguardando aprovação do orçamento',
  'Aguardando peças',
  'Em manutenção',
  'Pronto para retirada',
]

const emptyData = {
  clients: [],
  devices: [],
  orders: [],
  inventory: [],
  sales: [],
  cash: [],
  finance: {
    receitas: 0,
    despesas: 0,
    contasPagar: 0,
    contasReceber: 0,
    lucroBruto: 0,
    lucroLiquido: 0,
    vendas: 0,
    assistencia: 0,
    itensEstoque: 0,
  },
}

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function getOrderWhatsAppUrl(order) {
  const phone = String(order.phone || '').replace(/\D/g, '')
  if (!phone) return ''
  const internationalPhone = phone.startsWith('55') ? phone : `55${phone}`
  if (internationalPhone.length < 12 || internationalPhone.length > 13) return ''
  const workDetails = order.workReport ? `\nO que foi feito: ${order.workReport}` : ''
  const readyForPickup = order.status === 'Pronto para retirada'
  const introduction = readyForPickup
    ? `O serviço do seu aparelho ${order.device} foi concluído e está pronto para retirada na Soberano Assistência Técnica.`
    : `Temos uma atualização sobre o conserto do seu aparelho ${order.device} na Soberano Assistência Técnica.`
  const progress = readyForPickup ? '' : `\nEtapa atual: ${order.status}.`
  const message = `Olá, ${order.customer}! ${introduction}\nOS ${order.id}.${progress}\nServiço: ${order.service}${workDetails}\nValor: ${currency.format(Number(order.total) || 0)}`
  return `https://wa.me/${internationalPhone}?text=${encodeURIComponent(message)}`
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

function formatOrderDate(value) {
  if (!value) return '—'
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR').format(date)
}

function formatDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getPeriodSeries(sales, orders, startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00`)
  const end = new Date(`${endDate}T12:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return []

  const days = Math.floor((end - start) / 86400000) + 1
  const unit = days <= 14 ? 'day' : days <= 62 ? 'week' : 'month'
  const buckets = new Map()
  let cursor = new Date(start)

  while (cursor <= end) {
    const key = unit === 'month'
      ? `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
      : formatDateKey(cursor)
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: unit === 'month'
          ? new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' }).format(cursor)
          : unit === 'week'
            ? formatOrderDate(key)
            : new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' }).format(cursor),
        sales: 0,
        service: 0,
      })
    }

    if (unit === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12)
    else cursor.setDate(cursor.getDate() + (unit === 'week' ? 7 : 1))
  }

  const getBucket = (date) => {
    const key = unit === 'month' ? date.slice(0, 7) : unit === 'week'
      ? formatDateKey((() => {
        const bucketDate = new Date(`${startDate}T12:00:00`)
        const offset = Math.floor((new Date(`${date}T12:00:00`) - bucketDate) / 86400000 / 7) * 7
        bucketDate.setDate(bucketDate.getDate() + offset)
        return bucketDate
      })())
      : date
    return buckets.get(key)
  }

  sales.forEach((sale) => {
    const bucket = getBucket(String(sale.date || '').slice(0, 10))
    if (bucket) bucket.sales += Number(sale.total || 0)
  })
  orders.forEach((order) => {
    if (order.status === 'Cancelado') return
    const bucket = getBucket(String(order.openedAt || '').slice(0, 10))
    if (bucket) bucket.service += Number(order.total || 0)
  })

  const series = [...buckets.values()]
  const maximum = Math.max(1, ...series.map((item) => item.sales + item.service))
  return series.map((item) => ({
    ...item,
    salesHeight: (item.sales / maximum) * 90,
    serviceHeight: (item.service / maximum) * 90,
    profitHeight: ((item.sales + item.service) / maximum) * 90,
  }))
}

async function requestApi(path, options) {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })

  const result = await response.json()
  if (!response.ok) throw new Error(result.error || result.message || 'Falha ao conectar com o servidor.')
  return result
}

function Pagination({ page, total, onChange }) {
  const pageCount = Math.max(1, Math.ceil(total / 10))
  if (pageCount <= 1) return null

  return (
    <nav className="pagination" aria-label="Paginação">
      <span>{(page - 1) * 10 + 1}–{Math.min(page * 10, total)} de {total}</span>
      <div>
        <button type="button" className="ghost-btn" onClick={() => onChange(page - 1)} disabled={page === 1}>Anterior</button>
        <strong>Página {page} de {pageCount}</strong>
        <button type="button" className="ghost-btn" onClick={() => onChange(page + 1)} disabled={page === pageCount}>Próxima</button>
      </div>
    </nav>
  )
}

function App() {
  const [data, setData] = useState(emptyData)
  const [apiStatus, setApiStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loginConfigured, setLoginConfigured] = useState(false)
  const [password, setPassword] = useState('')
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [passwordChanged, setPasswordChanged] = useState(false)
  const username = 'richer'
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [today] = useState(() => formatDateKey(new Date()))
  const [dashboardPeriod, setDashboardPeriod] = useState('month')
  const [customPeriod, setCustomPeriod] = useState(() => ({
    start: `${today.slice(0, 7)}-01`,
    end: today,
  }))
  const [activeTab, setActiveTab] = useState('dashboard')
  const [searchClient, setSearchClient] = useState('')
  const [searchDevice, setSearchDevice] = useState('')
  const [clientPage, setClientPage] = useState(1)
  const [devicePage, setDevicePage] = useState(1)
  const [editingClientId, setEditingClientId] = useState('')
  const [editingDeviceId, setEditingDeviceId] = useState('')
  const [editingOrderId, setEditingOrderId] = useState('')
  const [editingCashId, setEditingCashId] = useState('')
  const [selectedOrderClientId, setSelectedOrderClientId] = useState('')
  const [selectedOrderDeviceId, setSelectedOrderDeviceId] = useState('')
  const [showOrderClientSuggestions, setShowOrderClientSuggestions] = useState(false)
  const [orderParts, setOrderParts] = useState([])
  const [partDraft, setPartDraft] = useState({ inventoryId: '', quantity: 1 })
  const [lastSavedClient, setLastSavedClient] = useState(null)
  const [searchInventory, setSearchInventory] = useState('')
  const [showInventoryForm, setShowInventoryForm] = useState(false)
  const [adjustingInventoryId, setAdjustingInventoryId] = useState('')
  const [stockAdjustment, setStockAdjustment] = useState({ quantity: '', unitCost: '', note: '' })
  const [installPrompt, setInstallPrompt] = useState(null)
  const [isInstalled, setIsInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true)
  const [installMessage, setInstallMessage] = useState('')
  const [searchOrderHistory, setSearchOrderHistory] = useState('')
  const [inventoryForm, setInventoryForm] = useState({
    code: '',
    name: '',
    category: '',
    brand: '',
    model: '',
    stock: 0,
    minStock: 0,
    cost: '',
    price: 0,
    supplier: '',
  })
  const [saleForm, setSaleForm] = useState({ customer: '', inventoryId: '', quantity: 1 })
  const [saleCart, setSaleCart] = useState([])
  const [saleMethod, setSaleMethod] = useState('PIX')
  const [cashForm, setCashForm] = useState({
    description: '',
    type: 'saída',
    amount: '',
    date: today,
  })

  const [clientForm, setClientForm] = useState({
    name: '',
    cpf: '',
    phone: '',
    email: '',
    city: 'Santa Vitória do Palmar',
    notes: '',
  })

  const [deviceForm, setDeviceForm] = useState({
    ownerId: '',
    manufacturer: '',
    model: '',
    color: '',
    imei: '',
    serial: '',
    storage: '',
    condition: '',
    notes: '',
  })

  const [orderForm, setOrderForm] = useState({
    customer: '',
    phone: '',
    device: '',
    imei: '',
    service: '',
    workReport: '',
    status: 'Recebido',
    total: '',
  })

  useEffect(() => {
    let active = true
    requestApi('/session')
      .then(async (session) => {
        if (!active) return
        setLoginConfigured(session.configured)
        if (!session.configured) {
          setApiStatus('setup_required')
          return
        }
        if (!session.authenticated) {
          setApiStatus('unauthenticated')
          return
        }

        setIsAuthenticated(true)
        setMustChangePassword(session.mustChangePassword)
        if (session.mustChangePassword) {
          setApiStatus('password_change_required')
          return
        }
        const state = await requestApi('/state')
        if (active) {
          setData({ ...emptyData, ...state })
          setApiStatus('connected')
          setErrorMessage('')
        }
      })
      .catch((error) => {
        if (active) {
          setApiStatus('disconnected')
          setErrorMessage(error.message)
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault()
      setInstallPrompt(event)
      setInstallMessage('')
    }
    const onAppInstalled = () => {
      setIsInstalled(true)
      setInstallPrompt(null)
      setInstallMessage('Aplicativo instalado com sucesso.')
    }

    const registerSw = async () => {
      if (!('serviceWorker' in navigator)) return

      if (import.meta.env.PROD) {
        await navigator.serviceWorker.register('/sw.js')
      } else {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((registration) => registration.unregister()))
        const cacheNames = await caches.keys()
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
      }
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    registerSw().catch((error) => {
      console.error('Falha ao configurar o modo offline:', error)
    })

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const filteredClients = useMemo(() => {
    const term = searchClient.trim().toLowerCase()
    const digits = term.replace(/\D/g, '')
    return data.clients.filter(
      (client) =>
        String(client.name || '').toLowerCase().includes(term) ||
        String(client.cpf || '').toLowerCase().includes(term) ||
        (digits && String(client.cpf || '').replace(/\D/g, '').includes(digits)) ||
        String(client.phone || '').includes(term),
    )
  }, [data.clients, searchClient])

  const currentClientPage = Math.min(clientPage, Math.max(1, Math.ceil(filteredClients.length / 10)))
  const pagedClients = filteredClients.slice((currentClientPage - 1) * 10, currentClientPage * 10)

  const filteredDevices = useMemo(() => {
    return data.devices.filter((device) => {
      const owner = data.clients.find((client) => client.id === device.ownerId)
      const term = searchDevice.toLowerCase()
      return (
        String(device.manufacturer || '').toLowerCase().includes(term) ||
        String(device.model || '').toLowerCase().includes(term) ||
        String(device.imei || '').toLowerCase().includes(term) ||
        String(owner?.name || device.ownerName || '').toLowerCase().includes(term)
      )
    })
  }, [data.clients, data.devices, searchDevice])

  const currentDevicePage = Math.min(devicePage, Math.max(1, Math.ceil(filteredDevices.length / 10)))
  const pagedDevices = filteredDevices.slice((currentDevicePage - 1) * 10, currentDevicePage * 10)

  const getClientByNameOrCpf = (value) => {
    const term = String(value || '').trim().toLowerCase()
    const digits = term.replace(/\D/g, '')
    return data.clients.find((client) =>
      String(client.name || '').trim().toLowerCase() === term ||
      (digits && digits === String(client.cpf || '').replace(/\D/g, '')),
    )
  }
  const selectedOrderClient =
    data.clients.find((client) => client.id === selectedOrderClientId) ||
    getClientByNameOrCpf(orderForm.customer)
  const selectedClientDevices = selectedOrderClient
    ? data.devices.filter((device) => device.ownerId === selectedOrderClient.id)
    : []
  const orderClientSuggestions = (() => {
    const query = orderForm.customer.trim().toLowerCase()
    if (!query) return []
    const digits = query.replace(/\D/g, '')
    return data.clients
      .filter((client) => {
        const name = String(client.name || '').toLowerCase()
        const cpf = String(client.cpf || '').replace(/\D/g, '')
        return name.includes(query) || (digits.length > 0 && cpf.includes(digits))
      })
      .slice(0, 6)
  })()

  const filteredInventory = useMemo(() => {
    const term = searchInventory.trim().toLowerCase()
    return data.inventory
      .filter((item) =>
        [item.code, item.name, item.category, item.brand, item.model, item.supplier]
          .some((value) => String(value || '').toLowerCase().includes(term)),
      )
      .sort((left, right) => {
        const leftLow = Number(left.stock) <= Number(left.minStock)
        const rightLow = Number(right.stock) <= Number(right.minStock)
        return Number(rightLow) - Number(leftLow) || left.name.localeCompare(right.name)
      })
  }, [data.inventory, searchInventory])

  const activeSales = data.sales.filter((sale) => !sale.cancelledAt)
  const totalSales = activeSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0)
  const lowStockItems = data.inventory.filter((item) => item.stock <= item.minStock)
  const openOrders = data.orders.filter((order) => order.status !== 'Entregue ao cliente' && order.status !== 'Cancelado')
  const periodRange = useMemo(() => {
    const current = new Date(`${today}T12:00:00`)
    const end = today
    if (dashboardPeriod === 'today') return { start: today, end }
    if (dashboardPeriod === 'last7') {
      current.setDate(current.getDate() - 6)
      return { start: formatDateKey(current), end }
    }
    if (dashboardPeriod === 'last30') {
      current.setDate(current.getDate() - 29)
      return { start: formatDateKey(current), end }
    }
    if (dashboardPeriod === 'month') return { start: `${today.slice(0, 7)}-01`, end }
    if (dashboardPeriod === 'lastMonth') {
      const lastMonth = new Date(current.getFullYear(), current.getMonth() - 1, 1, 12)
      const lastDay = new Date(current.getFullYear(), current.getMonth(), 0, 12)
      return { start: formatDateKey(lastMonth), end: formatDateKey(lastDay) }
    }
    if (dashboardPeriod === 'year') return { start: `${today.slice(0, 4)}-01-01`, end }
    if (dashboardPeriod === 'custom') return customPeriod

    const dates = [
      ...data.sales.map((sale) => String(sale.date || '').slice(0, 10)),
      ...data.orders.map((order) => String(order.openedAt || '').slice(0, 10)),
      ...data.cash.map((entry) => String(entry.date || '').slice(0, 10)),
    ].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    return { start: dates.length ? dates.reduce((earliest, date) => date < earliest ? date : earliest) : `${today.slice(0, 7)}-01`, end }
  }, [dashboardPeriod, customPeriod, data.sales, data.orders, data.cash, today])

  const isPeriodValid = Boolean(periodRange.start && periodRange.end && periodRange.start <= periodRange.end)
  const inSelectedPeriod = (value) => {
    const date = String(value || '').slice(0, 10)
    return isPeriodValid && date >= periodRange.start && date <= periodRange.end
  }
  const periodSales = activeSales.filter((sale) => inSelectedPeriod(sale.date))
  const periodOrders = data.orders.filter((order) => inSelectedPeriod(order.openedAt))
  const activeOrders = data.orders.filter((order) => !order.paidAt)
  const completedOrders = data.orders.filter((order) => order.paidAt)
  const filteredCompletedOrders = completedOrders.filter((order) => {
    const term = searchOrderHistory.trim().toLowerCase()
    return [order.id, order.customer, order.device, order.service]
      .some((value) => String(value || '').toLowerCase().includes(term))
  })
  const periodCash = data.cash.filter((entry) => inSelectedPeriod(entry.date))
  const periodSalesRevenue = periodSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0)
  const periodServiceRevenue = periodOrders
    .filter((order) => order.status !== 'Cancelado')
    .reduce((sum, order) => sum + Number(order.total || 0), 0)
  const periodRevenue = periodSalesRevenue + periodServiceRevenue
  const periodExpenses = periodCash
    .filter((entry) => entry.type === 'saída')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  const periodOperatingExpenses = periodCash
    .filter((entry) => entry.type === 'saída' && entry.category !== 'inventory_purchase')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  const periodCosts =
    periodSales.reduce((sum, sale) => sum + Number(sale.cost || 0), 0) +
    periodOrders.reduce((sum, order) => sum + Number(order.partsCost || 0), 0)
  const periodProfit = periodRevenue - periodCosts - periodOperatingExpenses
  const periodLabel = dashboardPeriod === 'all'
    ? 'Todo o período'
    : isPeriodValid
      ? `${formatOrderDate(periodRange.start)} a ${formatOrderDate(periodRange.end)}`
      : 'Período inválido'
  const periodSeries = isPeriodValid
    ? getPeriodSeries(periodSales, periodOrders, periodRange.start, periodRange.end)
    : []

  const metrics = [
    { label: 'Faturamento no período', value: currency.format(periodRevenue), accent: 'green' },
    { label: 'Vendas no período', value: `${periodSales.length}`, accent: 'orange' },
    { label: 'Lucro estimado no período', value: currency.format(periodProfit), accent: 'green' },
    { label: 'OS no período', value: `${periodOrders.length}`, accent: 'orange' },
    { label: 'Aparelhos em estoque', value: `${data.finance.itensEstoque}`, accent: 'orange' },
    { label: 'Clientes cadastrados', value: `${data.clients.length}`, accent: 'orange' },
    { label: 'OS abertas', value: `${openOrders.length}`, accent: 'green' },
    { label: 'OS finalizadas no período', value: `${periodOrders.filter((order) => order.status === 'Entregue ao cliente').length}`, accent: 'orange' },
  ]

  const reloadData = async () => {
    const state = await requestApi('/state')
    setData({ ...emptyData, ...state })
    setApiStatus('connected')
    setErrorMessage('')
  }

  const saveRecord = async (resource, record) => {
    let created
    try {
      created = await requestApi(`/${resource}`, {
        method: 'POST',
        body: JSON.stringify(record),
      })
    } catch (error) {
      setErrorMessage(error.message)
      setApiStatus('disconnected')
      return false
    }

    setData((current) => ({ ...current, [resource]: [created, ...current[resource]] }))
    try {
      await reloadData()
    } catch (error) {
      setErrorMessage(`Salvo no banco, mas não foi possível atualizar a tela: ${error.message}`)
    }
    return created
  }

  const updateRecord = async (resource, id, record) => {
    try {
      await requestApi(`/${resource}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(record),
      })
      await reloadData()
      return true
    } catch (error) {
      setErrorMessage(error.message)
      return false
    }
  }

  const deleteRecord = async (resource, id, label) => {
    if (!window.confirm(`Deseja realmente excluir ${label}? Esta ação não pode ser desfeita.`)) return
    try {
      await requestApi(`/${resource}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      await reloadData()
      if (resource === 'clients') setLastSavedClient(null)
      if (resource === 'inventory') setAdjustingInventoryId('')
      if (resource === 'cash' && editingCashId === id) {
        setEditingCashId('')
        setCashForm({ description: '', type: 'saída', amount: '', date: today })
      }
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error.message)
    }
  }

  const handleLogin = async (event) => {
    event.preventDefault()
    try {
      await requestApi('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      setIsAuthenticated(true)
      const session = await requestApi('/session')
      setMustChangePassword(session.mustChangePassword)
      setPassword('')
      if (session.mustChangePassword) {
        setCurrentPassword(password)
        setApiStatus('password_change_required')
      } else {
        await reloadData()
      }
    } catch (error) {
      setErrorMessage(error.message)
      setApiStatus(loginConfigured ? 'unauthenticated' : 'setup_required')
    }
  }

  const handlePasswordChange = async (event) => {
    event.preventDefault()
    if (newPassword.length < 12) {
      setErrorMessage('A nova senha precisa ter pelo menos 12 caracteres.')
      return
    }
    if (newPassword === currentPassword) {
      setErrorMessage('Escolha uma senha diferente da senha atual.')
      return
    }

    setIsChangingPassword(true)
    setErrorMessage('')
    try {
      await requestApi('/account/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      setMustChangePassword(false)
      setPasswordChanged(true)
      setCurrentPassword('')
      setNewPassword('')
      await reloadData()
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      setIsChangingPassword(false)
    }
  }

  const handleLogout = async () => {
    try {
      await requestApi('/logout', { method: 'POST' })
      setIsAuthenticated(false)
      setApiStatus('unauthenticated')
    } catch (error) {
      setErrorMessage(error.message)
    }
  }

  const openAccount = () => {
    setCurrentPassword('')
    setNewPassword('')
    setPasswordChanged(false)
    setErrorMessage('')
    setActiveTab('conta')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleInstall = async () => {
    if (isInstalled) {
      openAccount()
      return
    }
    if (!installPrompt) {
      setInstallMessage('Se a instalação estiver disponível, use a opção “Instalar aplicativo” no menu do navegador. Ela pode não aparecer neste navegador ou se o aplicativo já estiver instalado.')
      openAccount()
      return
    }
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      setInstallPrompt(null)
      if (choice.outcome === 'accepted') {
        setInstallMessage('Instalação aceita. Siga as instruções do navegador para concluir.')
      } else {
        setInstallMessage('Instalação cancelada. Para tentar novamente, use a opção de instalação no menu do navegador.')
        openAccount()
      }
    } catch (error) {
      setInstallPrompt(null)
      setInstallMessage(`Não foi possível iniciar a instalação: ${error.message}. Tente pelo menu do navegador.`)
      openAccount()
    }
  }

  const handleClientSubmit = async (event) => {
    event.preventDefault()
    if (!clientForm.name) return

    const existingClient = data.clients.find((client) => client.id === editingClientId)
    const record = {
      ...clientForm,
      lastService: existingClient?.lastService || '',
      totalSpent: existingClient?.totalSpent || 0,
    }
    const saved = editingClientId
      ? await updateRecord('clients', editingClientId, record)
      : await saveRecord('clients', record)
    if (saved) {
      const savedClient = typeof saved === 'object'
        ? saved
        : data.clients.find((client) => client.id === editingClientId)
      setClientForm({ name: '', cpf: '', phone: '', email: '', city: 'Santa Vitória do Palmar', notes: '' })
      setLastSavedClient(editingClientId ? null : savedClient)
      setEditingClientId('')
    }
  }

  const handleDeviceSubmit = async (event) => {
    event.preventDefault()
    const record = {
      ...deviceForm,
      purchaseDate: data.devices.find((device) => device.id === editingDeviceId)?.purchaseDate || new Date().toISOString().slice(0, 10),
      history: editingDeviceId
        ? data.devices.find((device) => device.id === editingDeviceId)?.history || []
        : [],
    }
    const saved = editingDeviceId
      ? await updateRecord('devices', editingDeviceId, record)
      : await saveRecord('devices', record)
    if (saved) {
      setDeviceForm({ ownerId: '', manufacturer: '', model: '', color: '', imei: '', serial: '', storage: '', condition: '', notes: '' })
      setEditingDeviceId('')
    }
  }

  const addOrderPart = () => {
    if (!selectedOrderDeviceId) {
      setErrorMessage('Selecione um aparelho cadastrado antes de adicionar peças à ordem.')
      return
    }

    const inventoryItem = data.inventory.find((item) => item.id === partDraft.inventoryId)
    const quantity = Number(partDraft.quantity)
    if (!inventoryItem || !Number.isInteger(quantity) || quantity <= 0) {
      setErrorMessage('Selecione uma peça e informe uma quantidade inteira válida.')
      return
    }

    const currentQuantity = orderParts.find((part) => part.inventoryId === inventoryItem.id)?.quantity || 0
    const previouslyUsed = data.orders.find((order) => order.id === editingOrderId)
      ?.partsUsed?.find((part) => part.inventoryId === inventoryItem.id)?.quantity || 0
    if (currentQuantity + quantity > Number(inventoryItem.stock) + previouslyUsed) {
      setErrorMessage(`Estoque insuficiente para ${inventoryItem.name}. Disponível: ${Number(inventoryItem.stock) + previouslyUsed}.`)
      return
    }

    setOrderParts((current) => {
      const existing = current.find((part) => part.inventoryId === inventoryItem.id)
      if (existing) {
        return current.map((part) => part.inventoryId === inventoryItem.id
          ? { ...part, quantity: part.quantity + quantity }
          : part)
      }
      return [...current, {
        inventoryId: inventoryItem.id,
        name: inventoryItem.name,
        quantity,
        unitCost: Number(inventoryItem.cost || 0),
      }]
    })
    setPartDraft({ inventoryId: '', quantity: 1 })
    setErrorMessage('')
  }

  const selectOrderClient = (client) => {
    const devices = data.devices.filter((device) => device.ownerId === client.id)
    const device = devices.length === 1 ? devices[0] : null
    setSelectedOrderClientId(client.id)
    setSelectedOrderDeviceId(device?.id || '')
    setOrderParts([])
    setPartDraft({ inventoryId: '', quantity: 1 })
    setOrderForm((current) => ({
      ...current,
      customer: client.name,
      phone: client.phone || '',
      device: device ? `${device.manufacturer} ${device.model}` : '',
      imei: device?.imei || '',
    }))
    setShowOrderClientSuggestions(false)
  }

  const removeOrderPart = (inventoryId) => {
    const remaining = orderParts.filter((part) => part.inventoryId !== inventoryId)
    setOrderParts(remaining)
  }

  const handleOrderSubmit = async (event) => {
    event.preventDefault()
    const selectedClient = selectedOrderClient
    const existingOrder = data.orders.find((order) => order.id === editingOrderId)
    const record = {
      ...orderForm,
      customer: selectedClient?.name || orderForm.customer,
      customerId: selectedClient?.id || '',
      phone: selectedClient?.phone || orderForm.phone,
      deviceId: selectedOrderDeviceId,
      partsUsed: orderParts.map(({ inventoryId, quantity }) => ({ inventoryId, quantity })),
      laborCost: Number(orderForm.total) || 0,
      discount: 0,
      total: Number(orderForm.total) || 0,
      deposit: existingOrder?.deposit || 0,
      eta: existingOrder?.eta || '',
      warranty: existingOrder?.warranty || '',
    }
    const saved = editingOrderId
      ? await updateRecord('orders', editingOrderId, record)
      : await saveRecord('orders', record)
    if (saved) {
      setOrderForm({ customer: '', phone: '', device: '', imei: '', service: '', workReport: '', status: 'Recebido', total: '' })
      setSelectedOrderClientId('')
      setSelectedOrderDeviceId('')
      setOrderParts([])
      setPartDraft({ inventoryId: '', quantity: 1 })
      setEditingOrderId('')
    }
  }

  const beginDeviceRegistration = (client) => {
    setDeviceForm({ ownerId: client.id, manufacturer: '', model: '', color: '', imei: '', serial: '', storage: '', condition: '', notes: '' })
    setEditingDeviceId('')
    setLastSavedClient(null)
    setActiveTab('aparelhos')
  }

  const beginClientEdit = (client) => {
    setClientForm({
      name: client.name || '',
      cpf: client.cpf || '',
      phone: client.phone || '',
      email: client.email || '',
      city: client.city || 'Santa Vitória do Palmar',
      notes: client.notes || '',
    })
    setEditingClientId(client.id)
    setLastSavedClient(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const beginDeviceEdit = (device) => {
    setDeviceForm({
      ownerId: device.ownerId || '',
      manufacturer: device.manufacturer || '',
      model: device.model || '',
      color: device.color || '',
      imei: device.imei || '',
      serial: device.serial || '',
      storage: device.storage || '',
      condition: device.condition || '',
      notes: device.notes || '',
    })
    setEditingDeviceId(device.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const beginOrderEdit = (order) => {
    setOrderForm({
      customer: order.customer || '',
      phone: order.phone || '',
      device: order.device || '',
      imei: order.imei || '',
      service: order.service || '',
      workReport: order.workReport || '',
      status: order.status || 'Recebido',
      total: order.total ?? '',
    })
    const client = getClientByNameOrCpf(order.customer)
    const device = data.devices.find((entry) =>
      entry.id === order.deviceId ||
      (entry.ownerId === client?.id && `${entry.manufacturer} ${entry.model}` === order.device),
    )
    setSelectedOrderClientId(client?.id || '')
    setSelectedOrderDeviceId(device?.id || '')
    setOrderParts((order.partsUsed || []).map((part) => ({
      inventoryId: part.inventoryId,
      name: part.name,
      quantity: Number(part.quantity),
      unitCost: Number(part.unitCost || 0),
    })))
    setPartDraft({ inventoryId: '', quantity: 1 })
    setShowOrderClientSuggestions(false)
    setEditingOrderId(order.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const generateOrderPdf = (order) => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setErrorMessage('O navegador bloqueou a janela do PDF. Permita pop-ups para gerar a ordem de serviço.')
      return
    }

    const client = data.clients.find((entry) => entry.name === order.customer)
    const device = data.devices.find((entry) =>
      `${entry.manufacturer} ${entry.model}` === order.device &&
      (!client || entry.ownerId === client.id),
    )
    const logoUrl = `${window.location.origin}/logo-horizontal.png`
    const workReport = order.workReport || order.service || 'Relatório do serviço não informado.'
    const documentHtml = `<!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Ordem de Serviço ${escapeHtml(order.id)}</title>
          <style>
            @page { size: A4; margin: 14mm; }
            * { box-sizing: border-box; }
            body { margin: 0; color: #172119; font: 12px/1.5 Arial, sans-serif; }
            .sheet { width: 100%; }
            .header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-bottom: 14px; border-bottom: 2px solid #159c50; }
            .logo { display: block; width: 245px; max-height: 100px; object-fit: contain; object-position: left center; }
            .heading { text-align: right; }
            .heading h1 { margin: 0; font-size: 21px; letter-spacing: .04em; }
            .heading strong { display: block; margin-top: 5px; color: #159c50; font-size: 15px; }
            .section { margin-top: 18px; page-break-inside: avoid; }
            .section h2 { margin: 0 0 9px; padding-bottom: 5px; border-bottom: 1px solid #d6e0d8; color: #126d3a; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; }
            .field { min-height: 32px; }
            .field small { display: block; color: #607066; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; }
            .field strong { display: block; overflow-wrap: anywhere; font-size: 11px; }
            .report { min-height: 105px; padding: 11px; border: 1px solid #d6e0d8; border-radius: 5px; white-space: pre-wrap; overflow-wrap: anywhere; }
            .summary { display: flex; justify-content: space-between; align-items: center; gap: 15px; margin-top: 16px; padding: 12px 14px; border-radius: 5px; background: #edf7ef; }
            .summary small { display: block; color: #607066; font-size: 9px; text-transform: uppercase; }
            .summary strong { font-size: 16px; }
            .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 44px; margin-top: 58px; text-align: center; }
            .signature { padding-top: 7px; border-top: 1px solid #49554d; font-size: 10px; }
            .footer { margin-top: 28px; padding-top: 8px; border-top: 1px solid #d6e0d8; color: #607066; font-size: 9px; text-align: center; }
            @media screen { body { max-width: 780px; margin: 24px auto; padding: 24px; box-shadow: 0 0 12px #ccd4ce; } }
            @media print { body { max-width: none; margin: 0; padding: 0; box-shadow: none; } }
          </style>
        </head>
        <body>
          <main class="sheet">
            <header class="header">
              <img class="logo" src="${escapeHtml(logoUrl)}" alt="Soberano Assistência Técnica">
              <div class="heading"><h1>ORDEM DE SERVIÇO</h1><strong>${escapeHtml(order.id)}</strong></div>
            </header>
            <section class="section">
              <h2>Dados do atendimento</h2>
              <div class="grid">
                <div class="field"><small>Cliente</small><strong>${escapeHtml(order.customer)}</strong></div>
                <div class="field"><small>Telefone / WhatsApp</small><strong>${escapeHtml(order.phone || client?.phone || '—')}</strong></div>
                <div class="field"><small>CPF / CNPJ</small><strong>${escapeHtml(client?.cpf || '—')}</strong></div>
                <div class="field"><small>Data de abertura</small><strong>${escapeHtml(formatOrderDate(order.openedAt))}</strong></div>
                <div class="field"><small>Status</small><strong>${escapeHtml(order.status || 'Recebido')}</strong></div>
              </div>
            </section>
            <section class="section">
              <h2>Aparelho</h2>
              <div class="grid">
                <div class="field"><small>Marca e modelo</small><strong>${escapeHtml(order.device)}</strong></div>
                <div class="field"><small>IMEI</small><strong>${escapeHtml(order.imei || device?.imei || '—')}</strong></div>
                <div class="field"><small>Cor</small><strong>${escapeHtml(device?.color || '—')}</strong></div>
                <div class="field"><small>Capacidade</small><strong>${escapeHtml(device?.storage || '—')}</strong></div>
              </div>
            </section>
            <section class="section">
              <h2>Serviço solicitado</h2>
              <div class="report">${escapeHtml(order.service || '—')}</div>
            </section>
            <section class="section">
              <h2>Relatório do serviço executado</h2>
              <div class="report">${escapeHtml(workReport)}</div>
            </section>
            <div class="summary">
              <div><small>Valor da manutenção</small><strong>${escapeHtml(currency.format(Number(order.total || 0)))}</strong></div>
              <div><small>Data de emissão</small><strong>${escapeHtml(formatOrderDate(new Date().toISOString()))}</strong></div>
            </div>
            <div class="signatures">
              <div class="signature">Assinatura do cliente</div>
              <div class="signature">Soberano Assistência Técnica</div>
            </div>
            <footer class="footer">Obrigado por confiar na Soberano Assistência Técnica.</footer>
          </main>
        </body>
      </html>`

    const printDocument = () => {
      window.setTimeout(() => {
        printWindow.focus()
        printWindow.print()
      }, 300)
    }
    printWindow.document.open()
    printWindow.document.write(documentHtml)
    printWindow.document.close()
    const logo = printWindow.document.querySelector('.logo')
    if (logo?.complete) printDocument()
    else {
      logo?.addEventListener('load', printDocument, { once: true })
      logo?.addEventListener('error', printDocument, { once: true })
      printWindow.addEventListener('load', printDocument, { once: true })
    }
  }

  const updateOrderStatus = async (orderId, nextStatus) => {
    try {
      await requestApi(`/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      })
      await reloadData()
    } catch (error) {
      setErrorMessage(error.message)
      setApiStatus('disconnected')
    }
  }

  const finalizeOrderPaid = async (order) => {
    if (order.paidAt || order.status === 'Cancelado') return
    if (!window.confirm(`Confirmar que a OS ${order.id} foi paga e o conserto finalizado?`)) return

    try {
      await requestApi(`/orders/${encodeURIComponent(order.id)}/complete`, { method: 'POST' })
      await reloadData()
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error.message)
    }
  }

  const handleInventorySubmit = async (event) => {
    event.preventDefault()
    const saved = await saveRecord('inventory', {
      ...inventoryForm,
      stock: Number(inventoryForm.stock),
      minStock: Number(inventoryForm.minStock),
      cost: Number(inventoryForm.cost),
      price: Number(inventoryForm.price),
      entryDate: new Date().toISOString().slice(0, 10),
    })
    if (saved) {
      setInventoryForm({ code: '', name: '', category: '', brand: '', model: '', stock: 0, minStock: 0, cost: '', price: 0, supplier: '' })
      setShowInventoryForm(false)
    }
  }

  const handleStockAdjustment = async (event, item) => {
    event.preventDefault()
    const quantity = Number(stockAdjustment.quantity)
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setErrorMessage('Informe uma quantidade inteira maior que zero.')
      return
    }
    const unitCost = Number(stockAdjustment.unitCost)
    if (!Number.isFinite(unitCost) || unitCost <= 0) {
      setErrorMessage('Informe o custo unitário da reposição.')
      return
    }

    try {
      await requestApi(`/inventory/${encodeURIComponent(item.id)}/stock`, {
        method: 'POST',
        body: JSON.stringify({ quantity, unitCost, note: stockAdjustment.note }),
      })
      await reloadData()
      setAdjustingInventoryId('')
      setStockAdjustment({ quantity: '', unitCost: '', note: '' })
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error.message)
    }
  }

  const handleSaleSubmit = async (event) => {
    event.preventDefault()
    if (!saleCart.length) {
      setErrorMessage('Adicione ao menos um produto ao carrinho.')
      return
    }

    try {
      await requestApi('/sales/checkout', {
        method: 'POST',
        body: JSON.stringify({
          customer: saleForm.customer,
          method: saleMethod,
          items: saleCart.map(({ inventoryId, quantity }) => ({ inventoryId, quantity })),
        }),
      })
      await reloadData()
      setSaleForm({ customer: '', inventoryId: '', quantity: 1 })
      setSaleCart([])
      setSaleMethod('PIX')
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error.message)
    }
  }

  const handleSaleCancel = async (sale) => {
    if (sale.cancelledAt) return
    if (!window.confirm(`Deseja cancelar a venda ${sale.id}? Os produtos ainda cadastrados serão devolvidos ao estoque.`)) return

    try {
      await requestApi(`/sales/${encodeURIComponent(sale.id)}/cancel`, { method: 'POST' })
      await reloadData()
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error.message)
    }
  }

  const addSaleCartItem = () => {
    const item = data.inventory.find((product) => product.id === saleForm.inventoryId)
    const quantity = Number(saleForm.quantity)
    if (!item || !Number.isInteger(quantity) || quantity <= 0) {
      setErrorMessage('Selecione um produto e informe uma quantidade válida.')
      return
    }

    const existingQuantity = saleCart.find((entry) => entry.inventoryId === item.id)?.quantity || 0
    if (existingQuantity + quantity > Number(item.stock)) {
      setErrorMessage(`Estoque insuficiente para ${item.name}. Disponível: ${item.stock}.`)
      return
    }

    setSaleCart((current) => {
      const existing = current.find((entry) => entry.inventoryId === item.id)
      if (existing) {
        return current.map((entry) => entry.inventoryId === item.id
          ? { ...entry, quantity: entry.quantity + quantity }
          : entry)
      }
      return [...current, {
        inventoryId: item.id,
        name: item.name,
        quantity,
        unitPrice: Number(item.price),
      }]
    })
    setSaleForm((current) => ({ ...current, inventoryId: '', quantity: 1 }))
    setErrorMessage('')
  }

  const handleCashSubmit = async (event) => {
    event.preventDefault()
    const record = {
      ...cashForm,
      amount: Number(cashForm.amount),
    }
    const saved = editingCashId
      ? await updateRecord('cash', editingCashId, record)
      : await saveRecord('cash', record)
    if (saved) {
      setEditingCashId('')
      setCashForm({ description: '', type: 'saída', amount: '', date: today })
    }
  }

  const beginCashEdit = (item) => {
    setCashForm({
      description: item.description || '',
      type: item.type || 'saída',
      amount: String(item.amount ?? ''),
      date: item.date || today,
    })
    setEditingCashId(item.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const renderDashboard = () => (
    <>
      <section className="welcome-panel">
        <div className="welcome-copy">
          <span className="welcome-kicker">SEU DIA, SOB CONTROLE</span>
          <h2>Olá, Richer <span aria-hidden="true">✦</span></h2>
          <p>Veja o que precisa da sua atenção e continue de onde parou.</p>
        </div>
        <div className="quick-actions" aria-label="Atalhos">
          <button type="button" className="quick-action" onClick={() => setActiveTab('ordens')}>
            <span className="quick-action-icon">+</span>
            <span><strong>Nova ordem</strong><small>Receber aparelho</small></span>
          </button>
          <button type="button" className="quick-action" onClick={() => setActiveTab('clientes')}>
            <span className="quick-action-icon">+</span>
            <span><strong>Novo cliente</strong><small>Cadastrar contato</small></span>
          </button>
          <button type="button" className="quick-action" onClick={() => setActiveTab('estoque')}>
            <span className="quick-action-icon">+</span>
            <span><strong>Ver estoque</strong><small>Conferir produtos</small></span>
          </button>
        </div>
      </section>

      <section className="dashboard-period panel" aria-label="Período das informações">
        <div>
          <strong>Consultar período</strong>
          <span>{periodLabel}</span>
        </div>
        <div className="dashboard-period-controls">
          <select
            aria-label="Selecionar período"
            value={dashboardPeriod}
            onChange={(event) => setDashboardPeriod(event.target.value)}
          >
            <option value="today">Hoje</option>
            <option value="last7">Últimos 7 dias</option>
            <option value="last30">Últimos 30 dias</option>
            <option value="month">Este mês</option>
            <option value="lastMonth">Mês passado</option>
            <option value="year">Este ano</option>
            <option value="all">Todo o período</option>
            <option value="custom">Personalizado</option>
          </select>
          {dashboardPeriod === 'custom' && (
            <div className="dashboard-custom-dates">
              <label>
                De
                <input
                  type="date"
                  value={customPeriod.start}
                  max={customPeriod.end || undefined}
                  onChange={(event) => setCustomPeriod((current) => ({ ...current, start: event.target.value }))}
                />
              </label>
              <label>
                Até
                <input
                  type="date"
                  value={customPeriod.end}
                  min={customPeriod.start || undefined}
                  max={today}
                  onChange={(event) => setCustomPeriod((current) => ({ ...current, end: event.target.value }))}
                />
              </label>
            </div>
          )}
        </div>
      </section>
      {!isPeriodValid && (
        <p className="dashboard-period-error" role="alert">A data inicial deve ser anterior ou igual à data final.</p>
      )}

      <section className="cards-grid">
        {metrics.map((metric) => (
          <article key={metric.label} className={`metric-card accent-${metric.accent}`}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </section>

      <section className="content-grid two-columns">
        <div className="panel">
          <div className="panel-header">
            <h3>Faturamento no período</h3>
          </div>
          <div className="chart-bars" aria-label={`Gráfico de faturamento: ${periodLabel}`}>
            {periodSeries.some((item) => item.profit > 0) ? periodSeries.map((item) => (
              <div key={item.label} className="chart-column">
                <div className="bars-stack">
                  <span className="bar bar-sales" style={{ height: `${item.salesHeight}%` }} />
                  <span className="bar bar-service" style={{ height: `${item.serviceHeight}%` }} />
                  <span className="bar bar-profit" style={{ height: `${item.profitHeight}%` }} />
                </div>
                <label>{item.label}</label>
              </div>
            )) : <p className="empty-state">As vendas e serviços deste período aparecerão aqui.</p>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Resumo financeiro</h3>
          </div>
          <div className="mini-metrics">
            <div>
              <span>Receitas</span>
              <strong>{currency.format(periodRevenue)}</strong>
            </div>
            <div>
              <span>Despesas</span>
              <strong>{currency.format(periodExpenses)}</strong>
            </div>
            <div>
              <span>Lucro líquido</span>
              <strong>{currency.format(periodProfit)}</strong>
            </div>
            <div>
              <span>Contas a receber</span>
              <strong>{currency.format(data.finance.contasReceber)}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="content-grid two-columns">
        <div className="panel">
          <div className="panel-header">
            <h3>Ordens em andamento</h3>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>OS</th>
                  <th>Cliente</th>
                  <th>Estado</th>
                  <th>Valor da manutenção</th>
                </tr>
              </thead>
              <tbody>
                {openOrders.slice(0, 5).map((order) => (
                  <tr key={order.id}>
                    <td>{order.id}</td>
                    <td>{order.customer}</td>
                    <td><span className="status-pill status-neutral">{order.status}</span></td>
                    <td>{currency.format(order.total)}</td>
                  </tr>
                ))}
                {openOrders.length === 0 && (
                  <tr><td colSpan="4" className="empty-state">Nenhuma ordem em andamento.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Estoque crítico</h3>
          </div>
          <ul className="stack-list">
            {lowStockItems.map((item) => (
              <li key={item.code}>
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.brand} / {item.model}</small>
                </div>
                <span>{item.stock} em estoque</span>
              </li>
            ))}
            {lowStockItems.length === 0 && <li className="stock-all-good">Tudo certo: nenhum produto precisa de reposição.</li>}
          </ul>
        </div>
      </section>
    </>
  )

  const renderClientes = () => (
    <>
      <div className="panel form-panel">
        <div className="panel-header">
          <h3>{editingClientId ? 'Editar cliente' : 'Novo cliente'}</h3>
        </div>
        <form onSubmit={handleClientSubmit} className="form-grid">
          <input value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} placeholder="Nome completo" />
          <input value={clientForm.cpf} onChange={(e) => setClientForm({ ...clientForm, cpf: e.target.value })} placeholder="CPF / CNPJ" />
          <input value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })} placeholder="Telefone / WhatsApp" />
          <input value={clientForm.email} onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })} placeholder="E-mail" />
          <input value={clientForm.city} onChange={(e) => setClientForm({ ...clientForm, city: e.target.value })} placeholder="Cidade" />
          <textarea value={clientForm.notes} onChange={(e) => setClientForm({ ...clientForm, notes: e.target.value })} placeholder="Observações" className="full-width" rows="3" />
          <div className="form-actions full-width">
            {editingClientId && <button type="button" className="ghost-btn" onClick={() => { setEditingClientId(''); setClientForm({ name: '', cpf: '', phone: '', email: '', city: 'Santa Vitória do Palmar', notes: '' }) }}>Cancelar edição</button>}
            <button type="submit" className="primary-btn">{editingClientId ? 'Salvar alterações' : 'Salvar cliente'}</button>
          </div>
        </form>
      </div>

      {lastSavedClient && (
        <div className="saved-record-notice" role="status">
          <span><strong>Cliente salvo:</strong> {lastSavedClient.name}. Deseja registrar um aparelho para ele agora?</span>
          <button type="button" className="primary-btn" onClick={() => beginDeviceRegistration(lastSavedClient)}>Registrar aparelho</button>
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <h3>Clientes cadastrados <span className="list-total">{filteredClients.length}</span></h3>
          <input value={searchClient} onChange={(e) => { setSearchClient(e.target.value); setClientPage(1) }} placeholder="Buscar por nome, CPF ou telefone" aria-label="Buscar cliente" />
        </div>
        <div className="cards-list">
          {pagedClients.map((client) => (
            <article key={client.id} className="card-item">
              <div>
                <strong>{client.name}</strong>
                <small>{client.cpf || 'Sem CPF'} • {client.phone || 'Sem telefone'}</small>
              </div>
              {(client.email || client.city) && <p>{[client.email, client.city].filter(Boolean).join(' • ')}</p>}
              <div className="card-footer">
                <span>Último atendimento: {client.lastService || 'Nenhum'}</span>
                <strong>{currency.format(client.totalSpent)}</strong>
              </div>
              <div className="record-actions">
                <button type="button" className="ghost-btn" onClick={() => beginDeviceRegistration(client)}>+ Registrar aparelho</button>
                <button type="button" className="ghost-btn" onClick={() => beginClientEdit(client)}>Editar</button>
                <button type="button" className="danger-btn" onClick={() => deleteRecord('clients', client.id, `o cliente ${client.name}`)}>Excluir</button>
              </div>
            </article>
          ))}
          {filteredClients.length === 0 && <p className="empty-state">Nenhum cliente cadastrado.</p>}
        </div>
        <Pagination page={currentClientPage} total={filteredClients.length} onChange={setClientPage} />
      </div>
    </>
  )

  const renderAparelhos = () => (
    <>
      <div className="panel form-panel">
        <div className="panel-header">
          <h3>{editingDeviceId ? 'Editar aparelho' : 'Cadastro de aparelho'}</h3>
        </div>
        <form onSubmit={handleDeviceSubmit} className="form-grid">
          <select value={deviceForm.ownerId} onChange={(e) => setDeviceForm({ ...deviceForm, ownerId: e.target.value })} required>
            <option value="">Selecione o proprietário</option>
            {data.clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
          <input value={deviceForm.manufacturer} onChange={(e) => setDeviceForm({ ...deviceForm, manufacturer: e.target.value })} placeholder="Fabricante" required />
          <input value={deviceForm.model} onChange={(e) => setDeviceForm({ ...deviceForm, model: e.target.value })} placeholder="Modelo" required />
          <input value={deviceForm.color} onChange={(e) => setDeviceForm({ ...deviceForm, color: e.target.value })} placeholder="Cor" />
          <input value={deviceForm.imei} onChange={(e) => setDeviceForm({ ...deviceForm, imei: e.target.value })} placeholder="IMEI 1" />
          <input value={deviceForm.serial} onChange={(e) => setDeviceForm({ ...deviceForm, serial: e.target.value })} placeholder="Número de série" />
          <input value={deviceForm.storage} onChange={(e) => setDeviceForm({ ...deviceForm, storage: e.target.value })} placeholder="Capacidade (opcional)" />
          <input value={deviceForm.condition} onChange={(e) => setDeviceForm({ ...deviceForm, condition: e.target.value })} placeholder="Estado de conservação (opcional)" />
          <textarea value={deviceForm.notes} onChange={(e) => setDeviceForm({ ...deviceForm, notes: e.target.value })} placeholder="Observações" className="full-width" rows="3" />
          <div className="form-actions full-width">
            {editingDeviceId && <button type="button" className="ghost-btn" onClick={() => { setEditingDeviceId(''); setDeviceForm({ ownerId: '', manufacturer: '', model: '', color: '', imei: '', serial: '', storage: '', condition: '', notes: '' }) }}>Cancelar edição</button>}
            <button type="submit" className="primary-btn">{editingDeviceId ? 'Salvar alterações' : 'Cadastrar aparelho'}</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Histórico de aparelhos <span className="list-total">{filteredDevices.length}</span></h3>
          <input value={searchDevice} onChange={(e) => { setSearchDevice(e.target.value); setDevicePage(1) }} placeholder="Buscar marca, modelo, IMEI ou cliente" aria-label="Buscar aparelho" />
        </div>
        <div className="device-list">
          {pagedDevices.map((device) => {
            const owner = data.clients.find((client) => client.id === device.ownerId)
            return (
              <article key={device.id} className="device-card">
                <div className="device-head">
                  <div>
                    <strong>{device.manufacturer} {device.model}</strong>
                    <small>{owner?.name || device.ownerName || 'Sem proprietário vinculado'}</small>
                  </div>
                  {device.condition && <span className="pill">{device.condition}</span>}
                </div>
                <ul>
                  <li>IMEI: {device.imei}</li>
                  <li>S/N: {device.serial}</li>
                  {device.storage && <li>Armazenamento: {device.storage}</li>}
                </ul>
                <div className="timeline">
                  {device.history.map((item, idx) => (
                    <div key={`${device.id}-${idx}`} className="timeline-item">
                      <span className="dot" />
                      <small>{item}</small>
                    </div>
                  ))}
                </div>
                <div className="record-actions">
                  <button type="button" className="ghost-btn" onClick={() => beginDeviceEdit(device)}>Editar</button>
                  <button type="button" className="danger-btn" onClick={() => deleteRecord('devices', device.id, `o aparelho ${device.manufacturer} ${device.model}`)}>Excluir</button>
                </div>
              </article>
            )
          })}
          {filteredDevices.length === 0 && <p className="empty-state">Nenhum aparelho cadastrado.</p>}
        </div>
        <Pagination page={currentDevicePage} total={filteredDevices.length} onChange={setDevicePage} />
      </div>
    </>
  )

  const renderOrdens = () => (
    <>
      <div className="panel form-panel">
        <div className="panel-header">
          <h3>{editingOrderId ? `Editar ordem ${editingOrderId}` : 'Abrir ordem de serviço'}</h3>
        </div>
        <form onSubmit={handleOrderSubmit} className="form-grid">
          <div className="client-autocomplete">
            <input
              value={orderForm.customer}
              onFocus={() => setShowOrderClientSuggestions(true)}
              onChange={(event) => {
                const value = event.target.value
                const client = getClientByNameOrCpf(value)
                if (client) {
                  selectOrderClient(client)
                  return
                }
                if ((client?.id || '') !== selectedOrderClientId) {
                  setSelectedOrderDeviceId('')
                  setOrderParts([])
                }
                setSelectedOrderClientId(client?.id || '')
                setShowOrderClientSuggestions(true)
                setOrderForm((current) => ({
                  ...current,
                  customer: value,
                  phone: client?.phone || '',
                  device: (client?.id || '') !== selectedOrderClientId ? '' : current.device,
                  imei: (client?.id || '') !== selectedOrderClientId ? '' : current.imei,
                }))
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setShowOrderClientSuggestions(false)
                if (event.key === 'Enter' && orderClientSuggestions.length > 0 && !selectedOrderClient) {
                  event.preventDefault()
                  selectOrderClient(orderClientSuggestions[0])
                }
              }}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showOrderClientSuggestions && orderClientSuggestions.length > 0}
              aria-controls="order-client-suggestions"
              placeholder="Digite o nome ou CPF do cliente"
              autoComplete="off"
              required
            />
            {showOrderClientSuggestions && orderClientSuggestions.length > 0 && (
              <ul id="order-client-suggestions" className="client-suggestions" role="listbox">
                {orderClientSuggestions.map((client) => (
                  <li key={client.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={client.id === selectedOrderClientId}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectOrderClient(client)}
                    >
                      <strong>{client.name}</strong>
                      <span>CPF: {client.cpf || 'Não informado'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <input
            value={orderForm.phone}
            onChange={(event) => setOrderForm((current) => ({ ...current, phone: event.target.value }))}
            placeholder={selectedOrderClient ? 'Telefone não informado no cadastro' : 'Telefone'}
            readOnly={Boolean(selectedOrderClient)}
            aria-label={selectedOrderClient ? 'Telefone do cadastro do cliente' : 'Telefone'}
          />
          {selectedClientDevices.length > 0 ? (
            <select
              value={selectedOrderDeviceId}
              onChange={(event) => {
                const device = selectedClientDevices.find((entry) => entry.id === event.target.value)
                setSelectedOrderDeviceId(device?.id || '')
                setOrderForm((current) => ({
                  ...current,
                  device: device ? `${device.manufacturer} ${device.model}` : '',
                  imei: device?.imei || '',
                }))
              }}
              required
            >
              <option value="">Selecione o aparelho do cliente</option>
              {selectedClientDevices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.manufacturer} {device.model}{device.imei ? ` — IMEI ${device.imei}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input
                list="device-options"
                value={orderForm.device}
                onChange={(event) => {
                  const value = event.target.value
                  const device = data.devices.find((entry) =>
                    entry.ownerId === selectedOrderClient?.id &&
                    `${entry.manufacturer} ${entry.model}` === value,
                  )
                  setSelectedOrderDeviceId(device?.id || '')
                  setOrderForm((current) => ({ ...current, device: value, imei: device?.imei || current.imei }))
                }}
                placeholder="Modelo do aparelho"
                required
              />
              <datalist id="device-options">
                {selectedClientDevices.map((device) => (
                  <option key={device.id} value={`${device.manufacturer} ${device.model}`} />
                ))}
              </datalist>
            </>
          )}
          <input value={orderForm.imei} onChange={(e) => setOrderForm({ ...orderForm, imei: e.target.value })} placeholder="IMEI" />
          <input value={orderForm.service} onChange={(e) => setOrderForm({ ...orderForm, service: e.target.value })} placeholder="Serviço" required />
          <select value={orderForm.status} onChange={(e) => setOrderForm({ ...orderForm, status: e.target.value })}>
            {statusOptions.map((status) => <option key={status}>{status}</option>)}
          </select>
          <label className="field-with-hint">
            Valor da manutenção
            <input type="number" min="0" step="0.01" value={orderForm.total} onChange={(e) => setOrderForm({ ...orderForm, total: e.target.value })} placeholder="Mão de obra / serviço" required />
            <small>Valor cobrado pelo serviço. O custo das peças é calculado pelos itens do estoque.</small>
          </label>
          <section className="order-parts full-width">
            <div className="order-parts-heading">
              <div>
                <strong>Peças utilizadas</strong>
                <small>Ao salvar a OS, as peças selecionadas serão baixadas do estoque e anotadas no histórico do aparelho.</small>
              </div>
              {!selectedOrderDeviceId && <span>Selecione um aparelho cadastrado</span>}
            </div>
            <div className="order-parts-controls">
              <select
                value={partDraft.inventoryId}
                onChange={(event) => setPartDraft((current) => ({ ...current, inventoryId: event.target.value }))}
                disabled={!selectedOrderDeviceId}
                aria-label="Peça do estoque"
              >
                <option value="">Selecione uma peça do estoque</option>
                {data.inventory.map((item) => {
                  const alreadyUsed = data.orders.find((order) => order.id === editingOrderId)
                    ?.partsUsed?.find((part) => part.inventoryId === item.id)?.quantity || 0
                  const available = Number(item.stock || 0) + alreadyUsed
                  return (
                    <option key={item.id} value={item.id} disabled={available < 1}>
                      {item.name} — {available} disponível
                    </option>
                  )
                })}
              </select>
              <input
                type="number"
                min="1"
                step="1"
                value={partDraft.quantity}
                onChange={(event) => setPartDraft((current) => ({ ...current, quantity: event.target.value }))}
                aria-label="Quantidade da peça"
                disabled={!selectedOrderDeviceId}
              />
              <button type="button" className="ghost-btn" onClick={addOrderPart} disabled={!selectedOrderDeviceId}>
                Adicionar peça
              </button>
            </div>
            {orderParts.length > 0 ? (
              <ul className="order-parts-list">
                {orderParts.map((part) => (
                  <li key={part.inventoryId}>
                    <span><strong>{part.name}</strong><small>{part.quantity} un. × {currency.format(part.unitCost || 0)}</small></span>
                    <span>{currency.format(Number(part.unitCost || 0) * part.quantity)}</span>
                    <button type="button" className="danger-btn" onClick={() => removeOrderPart(part.inventoryId)}>Remover</button>
                  </li>
                ))}
              </ul>
            ) : <p className="order-parts-empty">Nenhuma peça selecionada.</p>}
          </section>
          <textarea value={orderForm.workReport} onChange={(e) => setOrderForm({ ...orderForm, workReport: e.target.value })} placeholder="Relatório do serviço executado (aparece no PDF)" className="full-width" rows="4" />
          <div className="form-actions full-width">
            {editingOrderId && <button type="button" className="ghost-btn" onClick={() => { setEditingOrderId(''); setSelectedOrderClientId(''); setSelectedOrderDeviceId(''); setOrderParts([]); setPartDraft({ inventoryId: '', quantity: 1 }); setShowOrderClientSuggestions(false); setOrderForm({ customer: '', phone: '', device: '', imei: '', service: '', workReport: '', status: 'Recebido', total: '' }) }}>Cancelar edição</button>}
            <button type="submit" className="primary-btn">{editingOrderId ? 'Salvar alterações' : 'Salvar OS'}</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Ordens de serviço</h3>
          <button type="button" className="ghost-btn" onClick={() => { setActiveTab('historico'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
            Ver histórico ({completedOrders.length})
          </button>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>OS</th>
                <th>Cliente</th>
                <th>Aparelho</th>
                <th>Status</th>
                <th>Valor da manutenção</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {activeOrders.map((order) => (
                <tr key={order.id}>
                  <td>{order.id}</td>
                  <td>{order.customer}</td>
                  <td>{order.device}</td>
                  <td>
                    <select value={order.status} onChange={(event) => updateOrderStatus(order.id, event.target.value)}>
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                  <td>{currency.format(order.total)}</td>
                  <td>
                    <div className="record-actions compact">
                      <button type="button" className="ghost-btn" onClick={() => generateOrderPdf(order)}>Gerar PDF</button>
                      <button type="button" className="ghost-btn" onClick={() => beginOrderEdit(order)}>Editar</button>
                      {order.status !== 'Cancelado' && (
                        <button type="button" className="primary-btn" onClick={() => finalizeOrderPaid(order)}>
                          Pago e finalizar
                        </button>
                      )}
                      {whatsappUpdateStatuses.includes(order.status) && getOrderWhatsAppUrl(order) && (
                        <a className="whatsapp-btn" href={getOrderWhatsAppUrl(order)} target="_blank" rel="noreferrer">
                          Avisar cliente
                        </a>
                      )}
                      <button type="button" className="danger-btn" onClick={() => deleteRecord('orders', order.id, `a ordem ${order.id}`)}>Excluir</button>
                    </div>
                  </td>
                </tr>
              ))}
              {activeOrders.length === 0 && <tr><td colSpan="6" className="empty-state">Nenhuma ordem de serviço em aberto.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )

  const renderHistorico = () => (
    <>
      <div className="history-intro">
        <div>
          <span className="history-kicker">REGISTROS CONCLUÍDOS</span>
          <h2>Seus serviços finalizados, em um só lugar.</h2>
          <p>As OS aparecem aqui após a confirmação em “Pago e finalizar”. OS apenas marcadas como entregues permanecem na lista de ordens até a confirmação do pagamento.</p>
        </div>
        <div className="history-count">
          <strong>{completedOrders.length}</strong>
          <span>{completedOrders.length === 1 ? 'OS finalizada' : 'OS finalizadas'}</span>
        </div>
      </div>
      <div className="panel">
        <div className="panel-header">
          <h3>Histórico de OS finalizadas <span className="list-total">{filteredCompletedOrders.length}</span></h3>
          <input
            type="search"
            value={searchOrderHistory}
            onChange={(event) => setSearchOrderHistory(event.target.value)}
            placeholder="Buscar OS, cliente, aparelho ou serviço"
            aria-label="Buscar no histórico de ordens de serviço"
          />
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>OS</th>
                <th>Cliente</th>
                <th>Aparelho</th>
                <th>Serviço</th>
                <th>Valor pago</th>
                <th>Finalizada em</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {filteredCompletedOrders.map((order) => (
                <tr key={order.id}>
                  <td>{order.id}</td>
                  <td>{order.customer}</td>
                  <td>{order.device}</td>
                  <td>{order.service}</td>
                  <td>{currency.format(order.total)}</td>
                  <td>{formatOrderDate(order.paidAt)}</td>
                  <td><button type="button" className="ghost-btn" onClick={() => generateOrderPdf(order)}>Gerar PDF</button></td>
                </tr>
              ))}
              {filteredCompletedOrders.length === 0 && (
                <tr><td colSpan="7" className="empty-state">{completedOrders.length ? 'Nenhuma OS corresponde à busca.' : 'As OS confirmadas como pagas e finalizadas aparecerão aqui.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )

  const renderEstoque = () => (
    <>
      <section className="inventory-summary" aria-label="Resumo do estoque">
        <article className="inventory-summary-card">
          <span>Produtos cadastrados</span>
          <strong>{data.inventory.length}</strong>
          <small>Tipos diferentes de produto</small>
        </article>
        <article className="inventory-summary-card">
          <span>Unidades disponíveis</span>
          <strong>{data.finance.itensEstoque}</strong>
          <small>Total de peças e aparelhos</small>
        </article>
        <article className={lowStockItems.length ? 'inventory-summary-card inventory-summary-warning' : 'inventory-summary-card'}>
          <span>Precisam de reposição</span>
          <strong>{lowStockItems.length}</strong>
          <small>Itens no mínimo ou abaixo</small>
        </article>
      </section>

      <div className="panel inventory-panel">
        <div className="panel-header inventory-header">
          <div>
            <h3>Produtos e peças</h3>
            <p>Consulte quantidades e registre reposições do estoque.</p>
          </div>
          <button
            type="button"
            className="primary-btn"
            onClick={() => setShowInventoryForm((current) => !current)}
          >
            {showInventoryForm ? 'Fechar cadastro' : '+ Cadastrar produto'}
          </button>
        </div>

        {showInventoryForm && (
          <form onSubmit={handleInventorySubmit} className="inventory-form">
            <div className="inventory-form-heading">
              <strong>Novo produto</strong>
              <span>Preencha os dados principais e a quantidade inicial.</span>
            </div>
            <div className="inventory-form-grid">
              <label>
                Código do produto
                <input value={inventoryForm.code} onChange={(event) => setInventoryForm({ ...inventoryForm, code: event.target.value })} placeholder="Ex.: TELA-IP13" required />
              </label>
              <label>
                Nome do produto
                <input value={inventoryForm.name} onChange={(event) => setInventoryForm({ ...inventoryForm, name: event.target.value })} placeholder="Ex.: Tela iPhone 13" required />
              </label>
              <label>
                Categoria
                <input value={inventoryForm.category} onChange={(event) => setInventoryForm({ ...inventoryForm, category: event.target.value })} placeholder="Ex.: Tela, acessório, celular" />
              </label>
              <label>
                Marca
                <input value={inventoryForm.brand} onChange={(event) => setInventoryForm({ ...inventoryForm, brand: event.target.value })} placeholder="Ex.: Apple" />
              </label>
              <label>
                Modelo compatível
                <input value={inventoryForm.model} onChange={(event) => setInventoryForm({ ...inventoryForm, model: event.target.value })} placeholder="Ex.: iPhone 13" />
              </label>
              <label>
                Quantidade inicial
                <input type="number" min="0" step="1" value={inventoryForm.stock} onChange={(event) => setInventoryForm({ ...inventoryForm, stock: event.target.value })} required />
              </label>
              <label>
                Avisar quando chegar a
                <input type="number" min="0" step="1" value={inventoryForm.minStock} onChange={(event) => setInventoryForm({ ...inventoryForm, minStock: event.target.value })} />
              </label>
              <label>
                Custo unitário
                <input type="number" min="0.01" step="0.01" value={inventoryForm.cost} onChange={(event) => setInventoryForm({ ...inventoryForm, cost: event.target.value })} required />
                <small>O custo da quantidade inicial será lançado automaticamente como despesa.</small>
              </label>
              <label>
                Preço de venda
                <input type="number" min="0" step="0.01" value={inventoryForm.price} onChange={(event) => setInventoryForm({ ...inventoryForm, price: event.target.value })} />
              </label>
              <label>
                Fornecedor
                <input value={inventoryForm.supplier} onChange={(event) => setInventoryForm({ ...inventoryForm, supplier: event.target.value })} placeholder="Nome do fornecedor" />
              </label>
            </div>
            <div className="inventory-form-actions">
              <button type="button" className="ghost-btn" onClick={() => setShowInventoryForm(false)}>Cancelar</button>
              <button type="submit" className="primary-btn">Salvar produto</button>
            </div>
          </form>
        )}

        <div className="inventory-toolbar">
          <input
            value={searchInventory}
            onChange={(event) => setSearchInventory(event.target.value)}
            placeholder="Buscar por produto, código, categoria ou fornecedor"
            aria-label="Buscar no estoque"
          />
          <span>{filteredInventory.length} {filteredInventory.length === 1 ? 'produto' : 'produtos'}</span>
        </div>

        {lowStockItems.length > 0 && (
          <div className="inventory-alert" role="status">
            <strong>{lowStockItems.length} {lowStockItems.length === 1 ? 'produto precisa' : 'produtos precisam'} de reposição.</strong>
            <span>Os itens aparecem primeiro na lista e estão marcados em laranja.</span>
          </div>
        )}

        <div className="table-wrapper">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Categoria</th>
                <th>Disponível</th>
                <th>Custo unitário</th>
                <th>Preço de venda</th>
                <th>Fornecedor</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {filteredInventory.map((item) => {
                const isLow = Number(item.stock) <= Number(item.minStock)
                return (
                  <Fragment key={item.id}>
                    <tr className={isLow ? 'warning' : ''}>
                      <td>
                        <strong className="inventory-product-name">{item.name}</strong>
                        <small className="inventory-product-code">{item.code}</small>
                      </td>
                      <td>{item.category || '—'}</td>
                      <td>
                        <span className={isLow ? 'stock-count stock-count-low' : 'stock-count'}>
                          {item.stock} un.
                        </span>
                        <small className="inventory-minimum">Mínimo: {item.minStock}</small>
                      </td>
                      <td>{currency.format(item.cost)}</td>
                      <td>{currency.format(item.price)}</td>
                      <td>{item.supplier || '—'}</td>
                      <td>
                        <div className="record-actions compact">
                          <button
                            type="button"
                            className="ghost-btn inventory-adjust-button"
                            onClick={() => {
                              setAdjustingInventoryId((current) => current === item.id ? '' : item.id)
                              setStockAdjustment({ quantity: '', unitCost: String(item.cost || ''), note: '' })
                            }}
                          >
                            {adjustingInventoryId === item.id ? 'Cancelar' : '+ Repor'}
                          </button>
                          <button
                            type="button"
                            className="danger-btn"
                            onClick={() => deleteRecord('inventory', item.id, `o produto ${item.name}`)}
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                    {adjustingInventoryId === item.id && (
                      <tr className="inventory-adjust-row">
                        <td colSpan="7">
                          <form onSubmit={(event) => handleStockAdjustment(event, item)}>
                            <label>
                              Quantidade recebida
                              <input type="number" min="1" step="1" value={stockAdjustment.quantity} onChange={(event) => setStockAdjustment({ ...stockAdjustment, quantity: event.target.value })} placeholder="Ex.: 5" required />
                            </label>
                            <label>
                              Custo unitário da reposição
                              <input type="number" min="0.01" step="0.01" value={stockAdjustment.unitCost} onChange={(event) => setStockAdjustment({ ...stockAdjustment, unitCost: event.target.value })} placeholder="Ex.: 25,00" required />
                            </label>
                            <label>
                              Observação (opcional)
                              <input value={stockAdjustment.note} onChange={(event) => setStockAdjustment({ ...stockAdjustment, note: event.target.value })} placeholder="Ex.: compra do fornecedor" />
                            </label>
                            <button type="submit" className="primary-btn">Adicionar ao estoque e lançar despesa</button>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {filteredInventory.length === 0 && (
                <tr>
                  <td colSpan="7" className="inventory-empty">
                    {searchInventory ? 'Nenhum produto corresponde à busca.' : 'Seu estoque está vazio. Use “Cadastrar produto” para começar.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )

  const renderVendas = () => (
    <>
      <div className="panel form-panel">
        <div className="panel-header"><h3>Montar carrinho</h3></div>
        <p className="sale-help">Adicione produtos do estoque. Escolha um cliente se desejar; sem cliente, a venda será registrada normalmente.</p>
        <div className="form-grid sale-cart-add">
          <select
            value={saleForm.inventoryId}
            onChange={(event) => {
              setSaleForm((current) => ({ ...current, inventoryId: event.target.value }))
            }}
          >
            <option value="">Selecione um produto do estoque</option>
            {data.inventory.map((item) => (
              <option key={item.id} value={item.id} disabled={item.stock < 1}>{item.name} — {item.stock} em estoque</option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            step="1"
            value={saleForm.quantity}
            onChange={(event) => setSaleForm((current) => ({ ...current, quantity: event.target.value }))}
            placeholder="Quantidade"
            required
          />
          <button type="button" className="primary-btn" onClick={addSaleCartItem}>Adicionar produto</button>
        </div>
        <div className="sale-customer-field">
          <label htmlFor="sale-customer">Nome do cliente (opcional)</label>
          <input
            id="sale-customer"
            type="text"
            value={saleForm.customer}
            onChange={(event) => setSaleForm((current) => ({ ...current, customer: event.target.value }))}
            placeholder="Digite o nome ou deixe em branco"
            list="sale-customer-suggestions"
          />
          <datalist id="sale-customer-suggestions">
            {data.clients.map((client) => (
              <option key={client.id} value={client.name} />
            ))}
          </datalist>
        </div>
        <div className="sale-cart-list">
          {saleCart.length > 0 ? (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Produto</th><th>Quantidade</th><th>Preço unitário</th><th>Subtotal</th><th>Ação</th></tr></thead>
                <tbody>
                  {saleCart.map((item) => (
                    <tr key={item.inventoryId}>
                      <td>{item.name}</td>
                      <td>{item.quantity}</td>
                      <td>{currency.format(item.unitPrice)}</td>
                      <td>{currency.format(item.unitPrice * item.quantity)}</td>
                      <td><button type="button" className="ghost-btn" onClick={() => setSaleCart((current) => current.filter((entry) => entry.inventoryId !== item.inventoryId))}>Remover</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="sale-cart-empty">Seu carrinho está vazio. Escolha um produto acima para começar.</p>}
        </div>
        <form onSubmit={handleSaleSubmit} className="sale-checkout">
          <div className="sale-total">
            <span>Total do carrinho</span>
            <strong>{currency.format(saleCart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0))}</strong>
          </div>
          <label>
            Forma de pagamento
            <select value={saleMethod} onChange={(event) => setSaleMethod(event.target.value)}>
              <option>PIX</option><option>Dinheiro</option><option>Cartão de débito</option><option>Cartão de crédito</option>
            </select>
          </label>
          <button type="submit" className="primary-btn" disabled={!saleCart.length}>Fechar carrinho e registrar venda</button>
        </form>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Resumo de vendas</h3>
        </div>
        <div className="mini-metrics">
          <div>
            <span>Receita total</span>
            <strong>{currency.format(totalSales)}</strong>
          </div>
          <div>
            <span>PIX</span>
            <strong>{currency.format(activeSales.filter((sale) => sale.method === 'PIX').reduce((sum, sale) => sum + Number(sale.total || 0), 0))}</strong>
          </div>
          <div>
            <span>Cartão</span>
            <strong>{currency.format(activeSales.filter((sale) => String(sale.method || '').includes('Cartão')).reduce((sum, sale) => sum + Number(sale.total || 0), 0))}</strong>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Últimas vendas</h3>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Produto</th>
                <th>Forma</th>
                <th>Total</th>
                <th>Status</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {data.sales.map((sale) => (
                <tr key={sale.id} className={sale.cancelledAt ? 'cancelled-sale' : ''}>
                  <td>{sale.id}</td>
                  <td>{sale.customer || 'Sem cliente'}</td>
                  <td>{sale.items?.map((item) => `${item.name} (${item.quantity})`).join(', ') || sale.product}</td>
                  <td>{sale.method}</td>
                  <td>{currency.format(sale.total)}</td>
                  <td>{sale.cancelledAt ? 'Cancelada' : 'Concluída'}</td>
                  <td>
                    {!sale.cancelledAt && (
                      <button type="button" className="danger-btn" onClick={() => handleSaleCancel(sale)}>
                        Cancelar venda
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {data.sales.length === 0 && <tr><td colSpan="7">Nenhuma venda registrada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )

  const renderFinanceiro = () => (
    <>
      <section className="cards-grid two-column-cards">
        <article className="metric-card accent-green">
          <span>Receitas</span>
          <strong>{currency.format(data.finance.receitas)}</strong>
        </article>
        <article className="metric-card accent-red">
          <span>Despesas</span>
          <strong>{currency.format(data.finance.despesas)}</strong>
        </article>
        <article className="metric-card accent-blue">
          <span>Faturamento de vendas</span>
          <strong>{currency.format(data.finance.vendas)}</strong>
        </article>
        <article className="metric-card accent-purple">
          <span>Faturamento de assistência</span>
          <strong>{currency.format(data.finance.assistencia)}</strong>
        </article>
        <article className="metric-card accent-orange">
          <span>Contas a receber de OS</span>
          <strong>{currency.format(data.finance.contasReceber)}</strong>
        </article>
      </section>

      <div className="panel form-panel">
        <div className="panel-header"><h3>{editingCashId ? 'Editar movimentação de caixa' : 'Registrar movimentação de caixa'}</h3></div>
        <form onSubmit={handleCashSubmit} className="form-grid">
          <input value={cashForm.description} onChange={(event) => setCashForm({ ...cashForm, description: event.target.value })} placeholder="Descrição" required />
          <select value={cashForm.type} onChange={(event) => setCashForm({ ...cashForm, type: event.target.value })}>
            <option value="entrada">Entrada</option><option value="saída">Saída</option>
          </select>
          <input type="number" min="0.01" step="0.01" value={cashForm.amount} onChange={(event) => setCashForm({ ...cashForm, amount: event.target.value })} placeholder="Valor" required />
          <input type="date" value={cashForm.date} onChange={(event) => setCashForm({ ...cashForm, date: event.target.value })} required aria-label="Data da movimentação" />
          <div className="form-actions full-width">
            {editingCashId && (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  setEditingCashId('')
                  setCashForm({ description: '', type: 'saída', amount: '', date: today })
                }}
              >
                Cancelar edição
              </button>
            )}
            <button type="submit" className="primary-btn">{editingCashId ? 'Salvar alterações' : 'Salvar movimentação'}</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Movimentações do caixa</h3>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Descrição</th>
                <th>Tipo</th>
                <th>Valor</th>
                <th>Data</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {data.cash.map((item) => (
                <tr key={item.id}>
                  <td>{item.description}</td>
                  <td>{item.type}</td>
                  <td>{currency.format(item.amount)}</td>
                  <td>{item.date}</td>
                  <td>
                    <div className="record-actions compact">
                      <button type="button" className="ghost-btn" onClick={() => beginCashEdit(item)}>Editar</button>
                      <button type="button" className="danger-btn" onClick={() => deleteRecord('cash', item.id, `a movimentação "${item.description}"`)}>Excluir</button>
                    </div>
                  </td>
                </tr>
              ))}
              {data.cash.length === 0 && <tr><td colSpan="5">Nenhuma movimentação registrada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )

  const renderConta = () => (
    <div className="account-page">
      <section className="account-hero">
        <div className="account-hero-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3 4 6v5c0 5 3.2 8.3 8 10 4.8-1.7 8-5 8-10V6l-8-3Z M9 12l2 2 4-4" /></svg>
        </div>
        <div>
          <span className="history-kicker">SEGURANÇA DA CONTA</span>
          <h2>Seu acesso, protegido.</h2>
          <p>Atualize sua senha e mantenha o Soberano sempre por perto.</p>
        </div>
      </section>

      <div className="account-page-grid">
        <section className="panel account-security">
          <div className="account-section-heading">
            <span className="account-section-icon" aria-hidden="true">✦</span>
            <div>
              <h3>Alterar senha</h3>
              <p>Confirme a senha atual e escolha uma nova senha pessoal.</p>
            </div>
          </div>
          <form className="account-password-form" onSubmit={handlePasswordChange}>
            <label htmlFor="account-current-password">Senha atual</label>
            <input id="account-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setPasswordChanged(false) }} required />
            <label htmlFor="account-new-password">Nova senha</label>
            <input id="account-new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordChanged(false) }} required />
            <small>Use pelo menos 12 caracteres e uma senha diferente da atual.</small>
            {passwordChanged && <p className="account-success" role="status">Senha alterada com sucesso.</p>}
            <button type="submit" className="primary-btn" disabled={isChangingPassword}>
              {isChangingPassword ? 'Salvando senha...' : 'Salvar nova senha'}
            </button>
          </form>
        </section>
        <section className="panel account-install">
          <div className="account-section-heading">
            <span className="account-section-icon" aria-hidden="true">↓</span>
            <div>
              <h3>Instalar o Soberano</h3>
              <p>Tenha acesso ao aplicativo direto pelo computador ou celular.</p>
            </div>
          </div>
          {isInstalled ? (
            <p className="account-success" role="status">Você está usando o aplicativo instalado.</p>
          ) : (
            <>
              <button type="button" className="ghost-btn account-install-action" onClick={handleInstall}>Instalar aplicativo</button>
              <p className="account-install-help">Se o botão de instalação não abrir, procure “Instalar aplicativo” ou “Adicionar à tela inicial” no menu do navegador. A disponibilidade depende do navegador e da instalação existente.</p>
            </>
          )}
          {installMessage && <p className="account-install-help" role="status">{installMessage}</p>}
        </section>
      </div>
    </div>
  )

  const renderContent = () => {
    switch (activeTab) {
      case 'clientes':
        return renderClientes()
      case 'aparelhos':
        return renderAparelhos()
      case 'ordens':
        return renderOrdens()
      case 'historico':
        return renderHistorico()
      case 'conta':
        return renderConta()
      case 'estoque':
        return renderEstoque()
      case 'vendas':
        return renderVendas()
      case 'financeiro':
        return renderFinanceiro()
      default:
        return renderDashboard()
    }
  }

  if (apiStatus === 'loading') {
    return <main className="connection-screen">Conectando ao servidor...</main>
  }

  if (apiStatus === 'setup_required') {
    return (
      <main className="connection-screen">
        <section className="connection-card">
          <img src="/logo-horizontal.png" alt="Soberano Assistência Técnica" />
          <h1>Configure o acesso seguro</h1>
          <p>Para proteger os dados dos clientes, configure as credenciais do Turso e a senha de acesso no servidor.</p>
          <ol>
            <li>Copie <code>.env.example</code> para <code>.env</code>.</li>
            <li>Preencha a URL e o token do banco Turso.</li>
            <li>Defina uma senha de acesso e uma chave de sessão.</li>
            <li>Reinicie o app com <code>npm run dev</code>.</li>
          </ol>
          {errorMessage && <p className="error-message" role="alert">{errorMessage}</p>}
        </section>
      </main>
    )
  }

  if (!isAuthenticated) {
    return (
      <main className="connection-screen">
        <form className="connection-card login-card" onSubmit={handleLogin}>
          <img src="/logo-horizontal.png" alt="Soberano Assistência Técnica" />
          <h1>Acessar o sistema</h1>
          <label htmlFor="app-username">Usuário</label>
          <input
            id="app-username"
            autoComplete="username"
            value={username}
            readOnly
            aria-describedby="login-user-note"
            required
          />
          <small id="login-user-note" className="login-user-note">Este aplicativo é de uso exclusivo do usuário Richer.</small>
          <label htmlFor="app-password">Senha de acesso</label>
          <input
            id="app-password"
            autoComplete="current-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {errorMessage && <p className="error-message" role="alert">{errorMessage}</p>}
          <button type="submit" className="primary-btn">Entrar</button>
          <small className="login-credit">Desenvolvido por Gustavo Braga</small>
        </form>
      </main>
    )
  }

  if (mustChangePassword) {
    return (
      <main className="connection-screen">
        <form className="connection-card login-card" onSubmit={handlePasswordChange}>
          <img src="/logo-horizontal.png" alt="Soberano Assistência Técnica" />
          <h1>Crie sua nova senha</h1>
          <p>Esta é a primeira entrada. Por segurança, escolha uma senha pessoal com pelo menos 12 caracteres.</p>
          <label htmlFor="current-password">Senha temporária</label>
          <input
            id="current-password"
            autoComplete="current-password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
          <label htmlFor="new-password">Nova senha</label>
          <input
            id="new-password"
            autoComplete="new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
          <small>A senha precisa ter pelo menos 12 caracteres.</small>
          {errorMessage && <p className="error-message" role="alert">{errorMessage}</p>}
          <button type="submit" className="primary-btn" disabled={isChangingPassword}>
            {isChangingPassword ? 'Salvando senha...' : 'Salvar nova senha'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-box">
          <img src="/logo-horizontal.png" alt="Soberano Assistência Técnica" />
          <span>GESTÃO • LOJA + SERVIÇOS</span>
        </div>

        <nav className="nav-menu">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{group.label}</span>
              {group.ids.map((id) => {
                const item = navItems.find((navItem) => navItem.id === id)
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={activeTab === item.id ? 'nav-item active' : 'nav-item'}
                    onClick={() => setActiveTab(item.id)}
                    aria-current={activeTab === item.id ? 'page' : undefined}
                  >
                    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d={item.icon} />
                    </svg>
                    <span>{item.label}</span>
                    {item.id === 'ordens' && openOrders.length > 0 && <span className="nav-count">{openOrders.length}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="account-card">
            <span className="account-avatar" aria-hidden="true">R</span>
            <span className="account-copy"><strong>Richer</strong><small>Administrador</small></span>
            <button type="button" className="account-logout" onClick={handleLogout} aria-label="Sair do aplicativo" title="Sair">↗</button>
          </div>
          <div className="account-tools">
            <button type="button" className="password-toggle" onClick={openAccount} aria-current={activeTab === 'conta' ? 'page' : undefined}>
              Alterar senha
            </button>
          </div>
          <button type="button" className="install-btn" onClick={handleInstall}>
            <span className="install-label-full">{isInstalled ? 'Aplicativo instalado' : 'Instalar aplicativo'}</span>
            <span className="install-label-short">{isInstalled ? 'Instalado' : 'Instalar'}</span>
          </button>
          <small className="app-credit">Desenvolvido por Gustavo Braga</small>
        </div>
      </aside>

      <main className="main-panel">
        {errorMessage && (
          <div className="connection-alert" role="alert">
            <strong>{apiStatus === 'connected' ? 'Atenção' : 'Falha de conexão'}</strong>
            <span>{errorMessage}</span>
            <button type="button" className="ghost-btn" onClick={() => setErrorMessage('')} aria-label="Fechar aviso">Fechar</button>
          </div>
        )}
        <header className="topbar">
          <div>
            <p className="eyebrow">SOBERANO <span aria-hidden="true">/</span> {pageTitles[activeTab]}</p>
            <h1>{pageTitles[activeTab]}</h1>
            <p className="page-description">{pageDescriptions[activeTab]}</p>
          </div>
          <div className="topbar-actions">
            <button type="button" className="primary-btn topbar-sale" onClick={() => setActiveTab('vendas')}>
              <span aria-hidden="true">+</span> Nova venda
            </button>
          </div>
        </header>

        {renderContent()}
      </main>
    </div>
  )
}

export default App
