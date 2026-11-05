import 'dotenv/config'
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { createDatabase, initializeDatabase } from './db.js'

const resources = ['clients', 'devices', 'orders', 'inventory', 'sales', 'cash']
const orderStatuses = [
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
const moneyFields = {
  orders: ['partsCost', 'laborCost', 'discount', 'total', 'deposit'],
  inventory: ['stock', 'minStock', 'cost', 'price'],
  sales: ['total', 'cost'],
  cash: ['amount'],
}

const now = () => new Date().toISOString()
const sessionCookie = 'soberano_session'
const passwordKeyLength = 64

function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, passwordKeyLength)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

function verifyPassword(password, passwordHash) {
  const [saltHex, hashHex] = passwordHash.split(':')
  if (!saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), passwordKeyLength)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function parseRecord(row) {
  return JSON.parse(row.payload)
}

function getSessionToken(request) {
  const cookie = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookie}=`))
  return cookie?.slice(sessionCookie.length + 1)
}

function isValidSession(request, secret) {
  if (!secret) return false
  const token = getSessionToken(request)
  if (!token) return false

  const [encodedUsername, authVersion, expiresAt, signature] = token.split('.')
  if (!encodedUsername || !authVersion || !expiresAt || !signature || Number(expiresAt) < Date.now()) return null

  const expected = createHmac('sha256', secret).update(`${encodedUsername}.${authVersion}.${expiresAt}`).digest('base64url')
  const actualBytes = Buffer.from(signature)
  const expectedBytes = Buffer.from(expected)
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null

  try {
    return {
      username: Buffer.from(encodedUsername, 'base64url').toString('utf8'),
      authVersion: Number(authVersion),
    }
  } catch {
    return null
  }
}

function setSessionCookie(response, username, authVersion, secret) {
  const encodedUsername = Buffer.from(username).toString('base64url')
  const version = String(authVersion)
  const expiresAt = String(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const signature = createHmac('sha256', secret)
    .update(`${encodedUsername}.${version}.${expiresAt}`)
    .digest('base64url')
  response.cookie(sessionCookie, `${encodedUsername}.${version}.${expiresAt}.${signature}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  })
}

function validateRecord(resource, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return 'Envie um objeto JSON válido.'
  }

  const requiredByResource = {
    clients: ['name'],
    devices: ['ownerId', 'manufacturer', 'model'],
    orders: ['customer', 'device', 'service'],
    inventory: ['code', 'name'],
    sales: ['product', 'method'],
    cash: ['description', 'type'],
  }

  for (const field of requiredByResource[resource]) {
    if (record[field] === undefined || String(record[field]).trim() === '') {
      return `O campo "${field}" é obrigatório.`
    }
  }

  for (const field of moneyFields[resource] ?? []) {
    if (record[field] !== undefined && (!Number.isFinite(Number(record[field])) || Number(record[field]) < 0)) {
      return `O campo "${field}" precisa ser um número igual ou maior que zero.`
    }
  }

  if (resource === 'inventory') {
    for (const field of ['stock', 'minStock']) {
      if (record[field] !== undefined && !Number.isInteger(Number(record[field]))) {
        return `O campo "${field}" precisa ser um número inteiro.`
      }
    }
    if (Number(record.stock || 0) > 0 && Number(record.cost || 0) <= 0) {
      return 'Informe o custo unitário para registrar produtos no estoque.'
    }
  }

  if (resource === 'sales' && (!Number.isFinite(Number(record.total)) || Number(record.total) <= 0)) {
    return 'O valor da venda precisa ser maior que zero.'
  }

  if (resource === 'sales' && (!Number.isInteger(Number(record.quantity || 1)) || Number(record.quantity || 1) < 1)) {
    return 'A quantidade da venda precisa ser um número inteiro maior que zero.'
  }

  if (resource === 'cash' && (!Number.isFinite(Number(record.amount)) || Number(record.amount) <= 0)) {
    return 'O valor da movimentação precisa ser maior que zero.'
  }

  if (resource === 'orders' && record.status && !orderStatuses.includes(record.status)) {
    return 'Status de ordem de serviço inválido.'
  }

  if (resource === 'cash' && !['entrada', 'saída'].includes(record.type)) {
    return 'Tipo de movimentação inválido.'
  }

  return null
}

async function getFinance(db) {
  const result = await db.execute(
    'SELECT resource, payload FROM records WHERE resource IN (?, ?, ?, ?)',
    ['sales', 'orders', 'cash', 'inventory'],
  )
  const entries = result.rows.map(parseRecord)
  const sales = entries.filter((_, index) => result.rows[index].resource === 'sales')
  const orders = entries.filter((_, index) => result.rows[index].resource === 'orders')
  const cash = entries.filter((_, index) => result.rows[index].resource === 'cash')
  const expenses = cash
    .filter((entry) => entry.type === 'saída')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  const operatingExpenses = cash
    .filter((entry) => entry.type === 'saída' && entry.category !== 'inventory_purchase')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  const salesRevenue = sales.reduce((sum, entry) => sum + Number(entry.total || 0), 0)
  const serviceRevenue = orders
    .filter((entry) => !['Cancelado'].includes(entry.status))
    .reduce((sum, entry) => sum + Number(entry.total || 0), 0)
  const revenue = salesRevenue + serviceRevenue
  const costOfGoods = sales.reduce((sum, entry) => sum + Number(entry.cost || 0), 0)
  const partsCost = orders.reduce((sum, entry) => sum + Number(entry.partsCost || 0), 0)

  return {
    receitas: revenue,
    despesas: expenses,
    contasPagar: 0,
    contasReceber: 0,
    lucroBruto: revenue - costOfGoods - partsCost,
    lucroLiquido: revenue - costOfGoods - partsCost - operatingExpenses,
    vendas: salesRevenue,
    assistencia: serviceRevenue,
    itensEstoque: entries
      .filter((_, index) => result.rows[index].resource === 'inventory')
      .reduce((sum, entry) => sum + Number(entry.stock || 0), 0),
  }
}

function normalizeOrderParts(parts) {
  if (!Array.isArray(parts)) return { error: 'A lista de peças da ordem é inválida.' }
  const quantities = new Map()
  for (const part of parts) {
    const inventoryId = typeof part?.inventoryId === 'string' ? part.inventoryId : ''
    const quantity = Number(part?.quantity)
    if (!inventoryId || !Number.isInteger(quantity) || quantity <= 0) {
      return { error: 'Cada peça precisa ter uma quantidade inteira maior que zero.' }
    }
    quantities.set(inventoryId, (quantities.get(inventoryId) || 0) + quantity)
  }
  return { quantities }
}

async function hydrateOrderAssociations(executor, order) {
  const record = { ...order }
  if (record.customerId) {
    const result = await executor.execute({
      sql: 'SELECT payload FROM records WHERE resource = ? AND id = ?',
      args: ['clients', String(record.customerId)],
    })
    if (!result.rows.length) {
      return { status: 400, error: 'O cliente selecionado não está mais cadastrado.' }
    }
    const client = parseRecord(result.rows[0])
    record.customer = client.name
    record.phone = client.phone || ''
  }
  if (record.deviceId) {
    const result = await executor.execute({
      sql: 'SELECT payload FROM records WHERE resource = ? AND id = ?',
      args: ['devices', String(record.deviceId)],
    })
    if (!result.rows.length) {
      return { status: 400, error: 'O aparelho selecionado não está mais cadastrado.' }
    }
    const device = parseRecord(result.rows[0])
    if (record.customerId && device.ownerId !== record.customerId) {
      return { status: 400, error: 'O aparelho selecionado não pertence ao cliente informado.' }
    }
    record.device = `${device.manufacturer} ${device.model}`.trim()
    record.imei = device.imei || ''
  }
  return { record }
}

async function syncOrderParts(transaction, currentOrder, nextOrder, changedAt) {
  const shouldCalculatePartsCost = Array.isArray(nextOrder.partsUsed)
  const previous = normalizeOrderParts(currentOrder?.partsUsed || [])
  const requested = normalizeOrderParts(nextOrder.partsUsed || [])
  if (previous.error || requested.error) {
    return { status: 400, error: previous.error || requested.error }
  }

  const orderId = nextOrder.id
  const oldDeviceId = currentOrder?.deviceId || ''
  const deviceId = Object.hasOwn(nextOrder, 'deviceId') ? nextOrder.deviceId : oldDeviceId
  if (requested.quantities.size && !deviceId) {
    return { status: 400, error: 'Selecione um aparelho cadastrado para registrar as peças utilizadas.' }
  }

  if (deviceId) {
    const deviceResult = await transaction.execute({
      sql: 'SELECT payload FROM records WHERE resource = ? AND id = ?',
      args: ['devices', deviceId],
    })
    if (!deviceResult.rows.length && requested.quantities.size) {
      return { status: 400, error: 'O aparelho selecionado não está mais cadastrado.' }
    }
    if (deviceResult.rows.length) {
      const device = parseRecord(deviceResult.rows[0])
      if (requested.quantities.size) {
        const registeredModel = `${device.manufacturer} ${device.model}`.trim().toLowerCase()
        const orderModel = String(nextOrder.device || '').trim().toLowerCase()
        if (registeredModel !== orderModel && String(device.model || '').trim().toLowerCase() !== orderModel) {
          return { status: 400, error: 'O aparelho selecionado não corresponde ao aparelho da ordem de serviço.' }
        }
        if (nextOrder.customerId && device.ownerId !== nextOrder.customerId) {
          return { status: 400, error: 'Selecione um aparelho cadastrado para o cliente desta ordem.' }
        }
      }
    }
  }

  const ids = new Set([...previous.quantities.keys(), ...requested.quantities.keys()])
  const inventoryItems = new Map()
  for (const inventoryId of ids) {
    const result = await transaction.execute({
      sql: 'SELECT payload FROM records WHERE resource = ? AND id = ?',
      args: ['inventory', inventoryId],
    })
    if (!result.rows.length) {
      return { status: 404, error: 'Uma das peças da ordem não foi encontrada no estoque.' }
    }
    inventoryItems.set(inventoryId, parseRecord(result.rows[0]))
  }

  for (const [inventoryId, item] of inventoryItems) {
    const change = (previous.quantities.get(inventoryId) || 0) - (requested.quantities.get(inventoryId) || 0)
    if (change < 0 && Number(item.stock || 0) < -change) {
      return { status: 400, error: `Estoque insuficiente para ${item.name}. Disponível: ${item.stock || 0}.` }
    }
  }

  const partsUsed = []
  for (const [inventoryId, quantity] of requested.quantities) {
    const item = inventoryItems.get(inventoryId)
    const unitCost = Number(item.cost || 0)
    partsUsed.push({
      inventoryId,
      name: item.name,
      code: item.code || '',
      quantity,
      unitCost,
      totalCost: unitCost * quantity,
    })
  }
  nextOrder.partsUsed = partsUsed
  nextOrder.deviceId = requested.quantities.size ? deviceId : (nextOrder.deviceId || '')
  if (shouldCalculatePartsCost) {
    nextOrder.partsCost = partsUsed.reduce((sum, part) => sum + part.totalCost, 0)
  }

  for (const [inventoryId, item] of inventoryItems) {
    const oldQuantity = previous.quantities.get(inventoryId) || 0
    const newQuantity = requested.quantities.get(inventoryId) || 0
    const change = oldQuantity - newQuantity
    if (!change) continue
    item.stock = Number(item.stock || 0) + change
    item.stockHistory = [
      ...(item.stockHistory || []),
      {
        type: change > 0 ? 'entrada' : 'saída',
        quantity: Math.abs(change),
        note: `${change > 0 ? 'Estorno' : 'Utilização'} de peças na OS ${orderId}`,
        changedAt,
      },
    ]
    await transaction.execute({
      sql: 'UPDATE records SET payload = ?, updated_at = ? WHERE resource = ? AND id = ?',
      args: [JSON.stringify(item), changedAt, 'inventory', inventoryId],
    })
  }

  const deviceIdsToUpdate = new Set([oldDeviceId, deviceId].filter(Boolean))
  for (const targetDeviceId of deviceIdsToUpdate) {
    const targetDeviceResult = await transaction.execute({
      sql: 'SELECT payload FROM records WHERE resource = ? AND id = ?',
      args: ['devices', targetDeviceId],
    })
    if (!targetDeviceResult.rows.length) continue
    const device = parseRecord(targetDeviceResult.rows[0])
    const marker = `Peças utilizadas na OS ${orderId}:`
    const history = (device.history || []).filter((entry) => !String(entry).startsWith(marker))
    if (targetDeviceId === deviceId && partsUsed.length) {
      history.push(`${marker} ${partsUsed.map((part) => `${part.name} x${part.quantity}`).join(', ')} (${formatDate(changedAt)})`)
    }
    device.history = history
    await transaction.execute({
      sql: 'UPDATE records SET payload = ?, updated_at = ? WHERE resource = ? AND id = ?',
      args: [JSON.stringify(device), changedAt, 'devices', targetDeviceId],
    })
  }

  return { partsUsed }
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR').format(new Date(value))
}

async function recordStockPurchase(transaction, item, quantity, unitCost, changedAt) {
  const expense = {
    id: randomUUID(),
    description: `Compra de estoque: ${item.name} (${quantity} un.)`,
    type: 'saída',
    category: 'inventory_purchase',
    inventoryId: item.id,
    quantity,
    unitCost,
    amount: quantity * unitCost,
    date: changedAt.slice(0, 10),
  }
  await transaction.execute({
    sql: 'INSERT INTO records (resource, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    args: ['cash', expense.id, JSON.stringify(expense), changedAt, changedAt],
  })
  return expense
}

export function createApp({
  db = createDatabase(),
  appUsername = process.env.APP_USERNAME,
  initialPassword = process.env.APP_INITIAL_PASSWORD,
  sessionSecret = process.env.APP_SESSION_SECRET,
} = {}) {
  const app = express()
  app.use(express.json({ limit: '100kb' }))
  let databaseInitialization

  const prepareDatabase = async () => {
    if (!databaseInitialization) databaseInitialization = initializeDatabase(db)
    await databaseInitialization

    if (appUsername && initialPassword) {
      await db.execute({
        sql: `INSERT INTO app_users (username, password_hash, must_change_password, updated_at)
          VALUES (?, ?, 1, ?)
          ON CONFLICT(username) DO NOTHING`,
        args: [appUsername, hashPassword(initialPassword), now()],
      })
    }
  }

  app.get('/api/health', async (_request, response) => {
    if (!db) {
      return response.status(503).json({
        status: 'not_configured',
        message: 'Configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN no arquivo .env.',
      })
    }

    try {
      await db.execute('SELECT 1')
      return response.json({ status: 'connected' })
    } catch (error) {
      console.error('Falha ao verificar conexão com Turso:', error)
      return response.status(503).json({
        status: 'disconnected',
        message: 'Não foi possível conectar ao Turso. Confira a URL e o token.',
      })
    }
  })

  app.get('/api/session', async (request, response) => {
    const configured = Boolean(db && appUsername && sessionSecret && sessionSecret.length >= 32)
    if (!configured) return response.json({ configured: false, authenticated: false })

    try {
      await prepareDatabase()
      const session = isValidSession(request, sessionSecret)
      const user = session
        ? await db.execute({
            sql: 'SELECT must_change_password, auth_version FROM app_users WHERE username = ?',
            args: [session.username],
          })
        : null
      const authenticated = Boolean(
        user?.rows.length && Number(user.rows[0].auth_version) === session.authVersion,
      )
      response.json({
        configured: true,
        authenticated,
        mustChangePassword: authenticated && Boolean(user.rows[0].must_change_password),
      })
    } catch (error) {
      console.error('Falha ao carregar sessão do Turso:', error)
      response.status(503).json({
        configured: false,
        authenticated: false,
        message: 'Não foi possível conectar ao banco Turso. Confira a URL e o token.',
      })
    }
  })

  app.post('/api/login', async (request, response) => {
    if (!db || !appUsername || !sessionSecret || sessionSecret.length < 32) {
      return response.status(503).json({
        error: 'Configure o Turso, APP_USERNAME e APP_SESSION_SECRET no arquivo .env.',
      })
    }

    try {
      await prepareDatabase()
      const username = typeof request.body?.username === 'string' ? request.body.username : ''
      const submittedPassword = typeof request.body?.password === 'string' ? request.body.password : ''
      const result = await db.execute({
        sql: 'SELECT password_hash, must_change_password, auth_version FROM app_users WHERE username = ?',
        args: [appUsername],
      })
      if (username !== appUsername || !result.rows.length || !verifyPassword(submittedPassword, result.rows[0].password_hash)) {
        return response.status(401).json({ error: 'Usuário ou senha incorretos.' })
      }

      setSessionCookie(response, appUsername, result.rows[0].auth_version, sessionSecret)
      response.json({
        authenticated: true,
        mustChangePassword: Boolean(result.rows[0].must_change_password),
      })
    } catch (error) {
      console.error('Falha no login pelo Turso:', error)
      response.status(503).json({ error: 'Não foi possível acessar o banco Turso.' })
    }
  })

  app.post('/api/logout', (_request, response) => {
    response.clearCookie(sessionCookie, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })
    response.json({ authenticated: false })
  })

  app.use('/api', (request, response, next) => {
    if (!db || !appUsername || !sessionSecret || sessionSecret.length < 32) {
      return response.status(503).json({
        error: 'Configure o Turso, APP_USERNAME e APP_SESSION_SECRET no arquivo .env antes de usar o sistema.',
      })
    }
    const session = isValidSession(request, sessionSecret)
    if (session?.username !== appUsername) {
      return response.status(401).json({ error: 'Faça login para continuar.' })
    }

    prepareDatabase()
      .then(async () => {
        const result = await db.execute({
          sql: 'SELECT must_change_password, auth_version FROM app_users WHERE username = ?',
          args: [session.username],
        })
        if (!result.rows.length) {
          response.status(401).json({ error: 'Conta de acesso não encontrada.' })
          return
        }

        if (Number(result.rows[0].auth_version) !== session.authVersion) {
          response.status(401).json({ error: 'Sua sessão expirou. Faça login novamente.' })
          return
        }

        request.authUser = {
          username: session.username,
          mustChangePassword: Boolean(result.rows[0].must_change_password),
          authVersion: Number(result.rows[0].auth_version),
        }
        if (request.authUser.mustChangePassword && request.path !== '/account/password') {
          response.status(403).json({ error: 'Altere a senha temporária antes de continuar.' })
          return
        }
        next()
      })
      .catch((error) => {
        console.error('Falha ao validar a conta no Turso:', error)
        response.status(503).json({ error: 'Não foi possível validar a conta no banco Turso.' })
      })
  })

  app.post('/api/account/password', async (request, response) => {
    const currentPassword = typeof request.body?.currentPassword === 'string' ? request.body.currentPassword : ''
    const newPassword = typeof request.body?.newPassword === 'string' ? request.body.newPassword : ''
    if (newPassword.length < 12) {
      return response.status(400).json({ error: 'A nova senha precisa ter pelo menos 12 caracteres.' })
    }
    if (newPassword === currentPassword) {
      return response.status(400).json({ error: 'Escolha uma senha diferente da senha temporária.' })
    }

    try {
      const result = await db.execute({
        sql: 'SELECT password_hash FROM app_users WHERE username = ?',
        args: [request.authUser.username],
      })
      if (!result.rows.length || !verifyPassword(currentPassword, result.rows[0].password_hash)) {
        return response.status(401).json({ error: 'A senha atual está incorreta.' })
      }

      await db.execute({
        sql: `UPDATE app_users
          SET password_hash = ?, must_change_password = 0, auth_version = auth_version + 1, updated_at = ?
          WHERE username = ?`,
        args: [hashPassword(newPassword), now(), request.authUser.username],
      })
      setSessionCookie(response, request.authUser.username, request.authUser.authVersion + 1, sessionSecret)
      response.json({ passwordChanged: true })
    } catch (error) {
      console.error('Falha ao alterar a senha no Turso:', error)
      response.status(503).json({ error: 'Não foi possível salvar a nova senha no Turso.' })
    }
  })

  app.post('/api/inventory/:id/stock', async (request, response, next) => {
    const quantity = Number(request.body?.quantity)
    const unitCost = Number(request.body?.unitCost)
    const note = typeof request.body?.note === 'string' ? request.body.note.trim() : ''

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return response.status(400).json({ error: 'A quantidade recebida precisa ser um número inteiro maior que zero.' })
    }
    if (!Number.isFinite(unitCost) || unitCost <= 0) {
      return response.status(400).json({ error: 'Informe um custo unitário maior que zero para a reposição.' })
    }
    if (note.length > 200) {
      return response.status(400).json({ error: 'A observação pode ter no máximo 200 caracteres.' })
    }

    const transaction = await db.transaction('write')
    try {
      const result = await transaction.execute({
        sql: 'SELECT payload FROM records WHERE resource = ? AND id = ?',
        args: ['inventory', request.params.id],
      })
      if (!result.rows.length) {
        await transaction.rollback()
        return response.status(404).json({ error: 'Produto não encontrado no estoque.' })
      }

      const item = parseRecord(result.rows[0])
      const changedAt = now()
      const previousStock = Number(item.stock || 0)
      const previousCost = Number(item.cost || 0)
      item.stock = Number(item.stock || 0) + quantity
      item.cost = ((previousStock * previousCost) + (quantity * unitCost)) / item.stock
      item.stockHistory = [
        ...(item.stockHistory || []),
        { type: 'entrada', quantity, unitCost, totalCost: quantity * unitCost, note, changedAt },
      ]

      await transaction.execute({
        sql: 'UPDATE records SET payload = ?, updated_at = ? WHERE resource = ? AND id = ?',
        args: [JSON.stringify(item), changedAt, 'inventory', request.params.id],
      })
      await recordStockPurchase(transaction, item, quantity, unitCost, changedAt)
      await transaction.commit()
      response.json(item)
    } catch (error) {
      await transaction.rollback()
      next(error)
    }
  })

  app.use('/api', async (_request, response, next) => {
    if (!db) {
      return response.status(503).json({
        error: 'Banco de dados não configurado. Copie .env.example para .env e informe as credenciais do Turso.',
      })
    }

    try {
      await prepareDatabase()
      next()
    } catch (error) {
      databaseInitialization = undefined
      console.error('Falha ao inicializar o banco Turso:', error)
      response.status(503).json({
        error: 'Não foi possível inicializar o banco de dados Turso.',
      })
    }
  })

  app.get('/api/state', async (_request, response, next) => {
    try {
      const result = await db.execute(
        'SELECT resource, payload FROM records ORDER BY created_at DESC',
      )
      const state = Object.fromEntries(resources.map((resource) => [resource, []]))

      for (const row of result.rows) {
        state[row.resource].push(parseRecord(row))
      }

      state.finance = await getFinance(db)
      response.json(state)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/sales/checkout', async (request, response, next) => {
    const customer = typeof request.body?.customer === 'string' ? request.body.customer.trim() : ''
    const method = typeof request.body?.method === 'string' ? request.body.method.trim() : ''
    const allowedMethods = ['PIX', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito']
    const items = request.body?.items

    if (!allowedMethods.includes(method)) {
      return response.status(400).json({ error: 'Selecione uma forma de pagamento válida.' })
    }
    if (!Array.isArray(items) || items.length === 0) {
      return response.status(400).json({ error: 'Adicione ao menos um produto ao carrinho.' })
    }

    const quantities = new Map()
    for (const item of items) {
      const id = typeof item?.inventoryId === 'string' ? item.inventoryId : ''
      const quantity = Number(item?.quantity)
      if (!id || !Number.isInteger(quantity) || quantity <= 0) {
        return response.status(400).json({ error: 'Cada produto precisa ter uma quantidade inteira maior que zero.' })
      }
      quantities.set(id, (quantities.get(id) || 0) + quantity)
    }

    const transaction = await db.transaction('write')
    try {
      const soldItems = []
      for (const [inventoryId, quantity] of quantities) {
        const result = await transaction.execute({
          sql: 'SELECT payload FROM records WHERE resource = ? AND id = ?',
          args: ['inventory', inventoryId],
        })
        if (!result.rows.length) {
          await transaction.rollback()
          return response.status(404).json({ error: 'Um dos produtos do carrinho não foi encontrado no estoque.' })
        }

        const product = parseRecord(result.rows[0])
        if (Number(product.stock) < quantity) {
          await transaction.rollback()
          return response.status(400).json({ error: `Estoque insuficiente para ${product.name}. Disponível: ${product.stock}.` })
        }

        const unitPrice = Number(product.price || 0)
        const unitCost = Number(product.cost || 0)
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
          await transaction.rollback()
          return response.status(400).json({ error: `Defina um preço de venda válido para ${product.name} antes de fechar o carrinho.` })
        }

        product.stock = Number(product.stock) - quantity
        await transaction.execute({
          sql: 'UPDATE records SET payload = ?, updated_at = ? WHERE resource = ? AND id = ?',
          args: [JSON.stringify(product), now(), 'inventory', inventoryId],
        })
        soldItems.push({
          inventoryId,
          name: product.name,
          code: product.code || '',
          quantity,
          unitPrice,
          unitCost,
          total: unitPrice * quantity,
        })
      }

      const createdAt = now()
      const sale = {
        id: randomUUID(),
        customer,
        product: soldItems.map((item) => `${item.name} (${item.quantity})`).join(', '),
        items: soldItems,
        inventoryId: soldItems.length === 1 ? soldItems[0].inventoryId : '',
        quantity: soldItems.reduce((sum, item) => sum + item.quantity, 0),
        total: soldItems.reduce((sum, item) => sum + item.total, 0),
        cost: soldItems.reduce((sum, item) => sum + item.unitCost * item.quantity, 0),
        method,
        category: 'Produtos',
        date: new Date().toISOString().slice(0, 10),
      }
      await transaction.execute({
        sql: 'INSERT INTO records (resource, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        args: ['sales', sale.id, JSON.stringify(sale), createdAt, createdAt],
      })
      await transaction.commit()
      response.status(201).json(sale)
    } catch (error) {
      await transaction.rollback()
      next(error)
    }
  })

  app.post('/api/:resource', async (request, response, next) => {
    const { resource } = request.params
    if (!resources.includes(resource)) {
      return response.status(404).json({ error: 'Recurso não encontrado.' })
    }

    try {
      let requestRecord = request.body
      if (resource === 'orders') {
        const hydrated = await hydrateOrderAssociations(db, requestRecord)
        if (hydrated.error) return response.status(hydrated.status).json({ error: hydrated.error })
        requestRecord = hydrated.record
      }

      const validationError = validateRecord(resource, requestRecord)
      if (validationError) return response.status(400).json({ error: validationError })

      if (resource === 'devices') {
        const owner = await db.execute({
          sql: 'SELECT 1 FROM records WHERE resource = ? AND id = ?',
          args: ['clients', String(requestRecord.ownerId)],
        })
        if (!owner.rows.length) {
          return response.status(400).json({ error: 'Cadastre o cliente proprietário antes do aparelho.' })
        }
      }

      let id = randomUUID()
      if (resource === 'orders') {
          const transaction = await db.transaction('write')
          try {
            await transaction.execute({
              sql: 'INSERT INTO counters (name, value) VALUES (?, 0) ON CONFLICT(name) DO NOTHING',
              args: ['orders'],
            })
            await transaction.execute({
              sql: 'UPDATE counters SET value = value + 1 WHERE name = ?',
              args: ['orders'],
            })
            const counter = await transaction.execute({
              sql: 'SELECT value FROM counters WHERE name = ?',
              args: ['orders'],
            })
            id = `OS-${String(counter.rows[0].value).padStart(6, '0')}`
            await transaction.commit()
          } catch (error) {
            await transaction.rollback()
            throw error
          }
      }

      const createdAt = now()
      const record = {
        ...requestRecord,
        id,
        ...(resource === 'orders'
          ? {
              status: requestRecord.status || 'Recebido',
              openedAt: requestRecord.openedAt || createdAt,
              statusHistory: [
                { status: requestRecord.status || 'Recebido', changedAt: createdAt, responsible: 'Operador' },
              ],
            }
          : {}),
        ...(resource === 'inventory'
          ? {
              stock: Number(requestRecord.stock || 0),
              stockHistory: Number(requestRecord.stock || 0) > 0
                ? [{
                    type: 'entrada',
                    quantity: Number(requestRecord.stock),
                    unitCost: Number(requestRecord.cost),
                    totalCost: Number(requestRecord.stock) * Number(requestRecord.cost),
                    note: 'Estoque inicial',
                    changedAt: createdAt,
                  }]
                : requestRecord.stockHistory || [],
            }
          : {}),
      }

      if (resource === 'sales' && requestRecord.inventoryId) {
        const transaction = await db.transaction('write')
        try {
          const inventoryResult = await transaction.execute({
            sql: 'SELECT payload FROM records WHERE resource = ? AND id = ?',
            args: ['inventory', String(requestRecord.inventoryId)],
          })
          if (!inventoryResult.rows.length) {
            await transaction.rollback()
            return response.status(404).json({ error: 'Produto não encontrado no estoque.' })
          }

          const inventoryItem = parseRecord(inventoryResult.rows[0])
          const quantity = Number(requestRecord.quantity || 1)
          if (!Number.isInteger(quantity) || quantity < 1 || Number(inventoryItem.stock) < quantity) {
            await transaction.rollback()
            return response.status(400).json({ error: 'Quantidade indisponível no estoque.' })
          }

          inventoryItem.stock -= quantity
          await transaction.execute({
            sql: 'UPDATE records SET payload = ?, updated_at = ? WHERE resource = ? AND id = ?',
            args: [JSON.stringify(inventoryItem), createdAt, 'inventory', String(requestRecord.inventoryId)],
          })
          await transaction.execute({
            sql: 'INSERT INTO records (resource, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            args: [resource, id, JSON.stringify(record), createdAt, createdAt],
          })
          await transaction.commit()
        } catch (error) {
          await transaction.rollback()
          throw error
        }
      } else if (resource === 'orders') {
        const transaction = await db.transaction('write')
        try {
          const partsResult = await syncOrderParts(transaction, null, record, createdAt)
          if (partsResult.error) {
            await transaction.rollback()
            return response.status(partsResult.status).json({ error: partsResult.error })
          }
          await transaction.execute({
            sql: 'INSERT INTO records (resource, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            args: [resource, id, JSON.stringify(record), createdAt, createdAt],
          })
          await transaction.commit()
        } catch (error) {
          await transaction.rollback()
          throw error
        }
      } else if (resource === 'inventory' && Number(record.stock) > 0) {
        const transaction = await db.transaction('write')
        try {
          await transaction.execute({
            sql: 'INSERT INTO records (resource, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            args: [resource, id, JSON.stringify(record), createdAt, createdAt],
          })
          await recordStockPurchase(transaction, record, Number(record.stock), Number(record.cost), createdAt)
          await transaction.commit()
        } catch (error) {
          await transaction.rollback()
          throw error
        }
      } else {
        await db.execute({
          sql: `INSERT INTO records (resource, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
          args: [resource, id, JSON.stringify(record), createdAt, createdAt],
        })
      }

      response.status(201).json(record)
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/:resource/:id', async (request, response, next) => {
    const { resource, id } = request.params
    if (!resources.includes(resource)) {
      return response.status(404).json({ error: 'Recurso não encontrado.' })
    }

    try {
      const existing = await db.execute({
        sql: 'SELECT payload FROM records WHERE resource = ? AND id = ?',
        args: [resource, id],
      })
      if (!existing.rows.length) return response.status(404).json({ error: 'Registro não encontrado.' })

      const current = parseRecord(existing.rows[0])
      let record = { ...current, ...request.body, id }
      if (resource === 'orders') {
        const hydrated = await hydrateOrderAssociations(db, record)
        if (hydrated.error) return response.status(hydrated.status).json({ error: hydrated.error })
        record = hydrated.record
      }

      if (resource === 'orders' && request.body.status && request.body.status !== current.status) {
        if (!orderStatuses.includes(request.body.status)) {
          return response.status(400).json({ error: 'Status de ordem de serviço inválido.' })
        }
        record.statusHistory = [
          ...(current.statusHistory || []),
          { status: request.body.status, changedAt: now(), responsible: 'Operador' },
        ]
      }

      const validationError = validateRecord(resource, record)
      if (validationError) return response.status(400).json({ error: validationError })
      if (resource === 'devices' && record.ownerId !== current.ownerId) {
        const owner = await db.execute({
          sql: 'SELECT 1 FROM records WHERE resource = ? AND id = ?',
          args: ['clients', String(record.ownerId)],
        })
        if (!owner.rows.length) {
          return response.status(400).json({ error: 'Cadastre o cliente proprietário antes do aparelho.' })
        }
      }

      if (resource === 'orders') {
        const transaction = await db.transaction('write')
        try {
          const currentResult = await transaction.execute({
            sql: 'SELECT payload FROM records WHERE resource = ? AND id = ?',
            args: [resource, id],
          })
          if (!currentResult.rows.length) {
            await transaction.rollback()
            return response.status(404).json({ error: 'Registro não encontrado.' })
          }
          const currentOrder = parseRecord(currentResult.rows[0])
          const hydrated = await hydrateOrderAssociations(
            transaction,
            { ...currentOrder, ...request.body, id },
          )
          if (hydrated.error) {
            await transaction.rollback()
            return response.status(hydrated.status).json({ error: hydrated.error })
          }
          const updatedOrder = hydrated.record
          if (request.body.status && request.body.status !== currentOrder.status) {
            updatedOrder.statusHistory = [
              ...(currentOrder.statusHistory || []),
              { status: request.body.status, changedAt: now(), responsible: 'Operador' },
            ]
          }
          const orderValidationError = validateRecord(resource, updatedOrder)
          if (orderValidationError) {
            await transaction.rollback()
            return response.status(400).json({ error: orderValidationError })
          }
          const changedAt = now()
          const partsResult = await syncOrderParts(transaction, currentOrder, updatedOrder, changedAt)
          if (partsResult.error) {
            await transaction.rollback()
            return response.status(partsResult.status).json({ error: partsResult.error })
          }
          await transaction.execute({
            sql: 'UPDATE records SET payload = ?, updated_at = ? WHERE resource = ? AND id = ?',
            args: [JSON.stringify(updatedOrder), changedAt, resource, id],
          })
          await transaction.commit()
          return response.json(updatedOrder)
        } catch (error) {
          await transaction.rollback()
          throw error
        }
      }

      await db.execute({
        sql: 'UPDATE records SET payload = ?, updated_at = ? WHERE resource = ? AND id = ?',
        args: [JSON.stringify(record), now(), resource, id],
      })
      response.json(record)
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/:resource/:id', async (request, response, next) => {
    const { resource, id } = request.params
    if (!['clients', 'devices', 'orders'].includes(resource)) {
      return response.status(404).json({ error: 'Este tipo de registro não pode ser excluído por esta rota.' })
    }

    const transaction = await db.transaction('write')
    try {
      const existing = await transaction.execute({
        sql: 'SELECT payload FROM records WHERE resource = ? AND id = ?',
        args: [resource, id],
      })
      if (!existing.rows.length) {
        await transaction.rollback()
        return response.status(404).json({ error: 'Registro não encontrado.' })
      }

      if (resource === 'orders') {
        const order = parseRecord(existing.rows[0])
        const partsResult = await syncOrderParts(
          transaction,
          order,
          { ...order, partsUsed: [] },
          now(),
        )
        if (partsResult.error) {
          await transaction.rollback()
          return response.status(partsResult.status).json({ error: partsResult.error })
        }
      }

      if (resource === 'clients') {
        const client = parseRecord(existing.rows[0])
        const devices = await transaction.execute({
          sql: 'SELECT id, payload FROM records WHERE resource = ?',
          args: ['devices'],
        })
        for (const row of devices.rows) {
          const device = parseRecord(row)
          if (device.ownerId === id) {
            device.ownerId = ''
            device.ownerName = client.name
            await transaction.execute({
              sql: 'UPDATE records SET payload = ?, updated_at = ? WHERE resource = ? AND id = ?',
              args: [JSON.stringify(device), now(), 'devices', row.id],
            })
          }
        }
      }

      await transaction.execute({
        sql: 'DELETE FROM records WHERE resource = ? AND id = ?',
        args: [resource, id],
      })
      await transaction.commit()
      response.json({ deleted: true, id })
    } catch (error) {
      await transaction.rollback()
      next(error)
    }
  })

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Rota da API não encontrada.' })
  })

  app.use((error, _request, response, _next) => {
    console.error('Erro na API:', error)
    response.status(500).json({ error: 'Falha ao processar a solicitação.' })
  })

  const root = path.dirname(fileURLToPath(import.meta.url))
  const distPath = path.resolve(root, '../dist')
  if (existsSync(distPath)) {
    app.use(express.static(distPath))
    app.get('*path', (_request, response) => response.sendFile(path.join(distPath, 'index.html')))
  }

  return app
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp()
  const port = Number(process.env.PORT || process.env.API_PORT || 3001)
  app.listen(port, () => {
    console.log(`API Soberano disponível na porta ${port}`)
  })
}
