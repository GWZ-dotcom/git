import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createClient } from '@libsql/client'
import { createApp } from './index.js'

test('persists records, protects the API, and decrements stock atomically', async () => {
  const db = createClient({ url: 'file::memory:' })
  const createTransaction = db.transaction.bind(db)
  db.transaction = async (...args) => {
    const transaction = await createTransaction(...args)
    return new Proxy(transaction, {
      get(target, property) {
        if (property === 'execute') {
          return (...executeArgs) => {
            assert.equal(executeArgs.length, 1, 'transaction statements must pass arguments in the statement object')
            return target.execute(executeArgs[0])
          }
        }

        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
  const app = createApp({
    db,
    appUsername: 'richer',
    initialPassword: '1020304050',
    sessionSecret: 'a-session-secret-with-more-than-thirty-two-characters',
  })
  const server = app.listen(0)
  let restartedServer
  await once(server, 'listening')
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  const call = (path, { cookie, ...options } = {}) =>
    fetch(`${baseUrl}/api${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...options.headers,
      },
    })

  try {
    const sessionResponse = await call('/session')
    assert.equal(sessionResponse.status, 200)
    assert.equal((await sessionResponse.json()).configured, true)

    const unauthorized = await call('/state')
    assert.equal(unauthorized.status, 401)

    const invalidLogin = await call('/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'richer', password: 'wrong-password' }),
    })
    assert.equal(invalidLogin.status, 401)

    const login = await call('/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'richer', password: '1020304050' }),
    })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie').split(';')[0]
    assert.equal((await login.json()).mustChangePassword, true)

    const blockedState = await call('/state', { cookie })
    assert.equal(blockedState.status, 403)

    const passwordChange = await call('/account/password', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        currentPassword: '1020304050',
        newPassword: 'a-strong-new-test-password',
      }),
    })
    assert.equal(passwordChange.status, 200)
    const authenticatedCookie = passwordChange.headers.get('set-cookie').split(';')[0]

    const oldPasswordLogin = await call('/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'richer', password: '1020304050' }),
    })
    assert.equal(oldPasswordLogin.status, 401)

    const revokedSession = await call('/state', { cookie })
    assert.equal(revokedSession.status, 401)

    const initialState = await call('/state', { cookie: authenticatedCookie })
    assert.deepEqual((await initialState.json()).clients, [])

    const clientResponse = await call('/clients', {
      method: 'POST',
      cookie: authenticatedCookie,
      body: JSON.stringify({ name: 'Cliente de teste', phone: '11999999999' }),
    })
    assert.equal(clientResponse.status, 201)
    const client = await clientResponse.json()

    const deviceResponse = await call('/devices', {
      method: 'POST',
      cookie: authenticatedCookie,
      body: JSON.stringify({
        ownerId: client.id,
        manufacturer: 'Apple',
        model: 'iPhone de teste',
      }),
    })
    assert.equal(deviceResponse.status, 201)
    const device = await deviceResponse.json()

    const inventoryResponse = await call('/inventory', {
      method: 'POST',
      cookie: authenticatedCookie,
      body: JSON.stringify({
        code: 'TEST-001',
        name: 'Tela de teste',
        stock: 2,
        minStock: 1,
        cost: 8,
        price: 20,
      }),
    })
    assert.equal(inventoryResponse.status, 201)
    const item = await inventoryResponse.json()

    const saleResponse = await call('/sales', {
      method: 'POST',
      cookie: authenticatedCookie,
      body: JSON.stringify({
        product: item.name,
        inventoryId: item.id,
        quantity: 2,
        total: 40,
        cost: 16,
        method: 'PIX',
      }),
    })
    assert.equal(saleResponse.status, 201)

    const exhaustedSale = await call('/sales', {
      method: 'POST',
      cookie: authenticatedCookie,
      body: JSON.stringify({
        product: item.name,
        inventoryId: item.id,
        quantity: 1,
        total: 20,
        method: 'PIX',
      }),
    })
    assert.equal(exhaustedSale.status, 400)

    const stockAdjustment = await call(`/inventory/${item.id}/stock`, {
      method: 'POST',
      cookie: authenticatedCookie,
      body: JSON.stringify({ quantity: 3, unitCost: 8, note: 'Reposição de teste' }),
    })
    assert.equal(stockAdjustment.status, 200)
    const adjustedItem = await stockAdjustment.json()
    assert.equal(adjustedItem.stock, 3)
    assert.equal(adjustedItem.stockHistory.length, 2)
    assert.equal(adjustedItem.stockHistory[1].totalCost, 24)

    const stockAdjustmentWithoutCost = await call(`/inventory/${item.id}/stock`, {
      method: 'POST',
      cookie: authenticatedCookie,
      body: JSON.stringify({ quantity: 2 }),
    })
    assert.equal(stockAdjustmentWithoutCost.status, 400)

    const orderResponse = await call('/orders', {
      method: 'POST',
      cookie: authenticatedCookie,
      body: JSON.stringify({
        customer: 'Cliente de teste',
        customerId: client.id,
        deviceId: device.id,
        service: 'Diagnóstico',
        workReport: 'Substituição do componente e testes de funcionamento concluídos.',
        partsUsed: [{ inventoryId: item.id, quantity: 1 }],
        partsCost: 999,
        total: 50,
      }),
    })
    assert.equal(orderResponse.status, 201, JSON.stringify(await orderResponse.clone().json()))
    const order = await orderResponse.json()
    assert.match(order.id, /^OS-\d{6}$/)
    assert.equal(order.phone, client.phone)
    assert.equal(order.device, 'Apple iPhone de teste')
    assert.equal(order.partsCost, 8)

    const statusResponse = await call(`/orders/${order.id}`, {
      method: 'PATCH',
      cookie: authenticatedCookie,
      body: JSON.stringify({ status: 'Em análise' }),
    })
    assert.equal(statusResponse.status, 200)

    const unchangedPartsStateResponse = await call('/state', { cookie: authenticatedCookie })
    const unchangedPartsState = await unchangedPartsStateResponse.json()
    assert.equal(unchangedPartsState.inventory.find((entry) => entry.id === item.id).stock, 2)
    assert.equal(unchangedPartsState.devices[0].history.length, 1)

    const increasedPartsResponse = await call(`/orders/${order.id}`, {
      method: 'PATCH',
      cookie: authenticatedCookie,
      body: JSON.stringify({ partsUsed: [{ inventoryId: item.id, quantity: 2 }] }),
    })
    assert.equal(increasedPartsResponse.status, 200)
    assert.equal((await increasedPartsResponse.json()).partsCost, 16)

    const insufficientOrderParts = await call(`/orders/${order.id}`, {
      method: 'PATCH',
      cookie: authenticatedCookie,
      body: JSON.stringify({ partsUsed: [{ inventoryId: item.id, quantity: 4 }] }),
    })
    assert.equal(insufficientOrderParts.status, 400)

    const finalStateResponse = await call('/state', { cookie: authenticatedCookie })
    const state = await finalStateResponse.json()
    assert.equal(state.clients.length, 1)
    assert.equal(state.devices.length, 1)
    assert.equal(state.orders[0].statusHistory.length, 2)
    assert.equal(state.orders[0].workReport, 'Substituição do componente e testes de funcionamento concluídos.')
    assert.equal(state.orders[0].partsCost, 16)
    assert.equal(state.inventory[0].stock, 1)
    assert.equal(state.inventory[0].stockHistory[0].quantity, 2)
    assert.equal(state.inventory[0].stockHistory[0].totalCost, 16)
    assert.equal(state.inventory[0].stockHistory[1].quantity, 3)
    assert.equal(state.inventory[0].stockHistory[1].type, 'entrada')
    assert.equal(state.inventory[0].stockHistory[1].totalCost, 24)
    assert.equal(state.inventory[0].stockHistory[2].type, 'saída')
    assert.equal(state.inventory[0].stockHistory[2].quantity, 1)
    assert.equal(state.devices[0].history.length, 1)
    assert.match(state.devices[0].history[0], /Tela de teste x2/)
    assert.equal(state.sales.length, 1)
    assert.equal(state.finance.vendas, 40)
    assert.equal(state.finance.assistencia, 50)
    assert.equal(state.finance.itensEstoque, 1)
    assert.equal(state.finance.despesas, 40)
    assert.equal(state.cash.length, 2)
    assert.equal(state.cash.reduce((sum, entry) => sum + entry.amount, 0), 40)

    const secondInventoryResponse = await call('/inventory', {
      method: 'POST',
      cookie: authenticatedCookie,
      body: JSON.stringify({
        code: 'TEST-002',
        name: 'Capa de teste',
        stock: 2,
        minStock: 1,
        cost: 5,
        price: 30,
      }),
    })
    assert.equal(secondInventoryResponse.status, 201)
    const secondItem = await secondInventoryResponse.json()

    const checkoutResponse = await call('/sales/checkout', {
      method: 'POST',
      cookie: authenticatedCookie,
      body: JSON.stringify({
        customer: client.name,
        method: 'Cartão de crédito',
        items: [
          { inventoryId: item.id, quantity: 1 },
          { inventoryId: secondItem.id, quantity: 1 },
        ],
      }),
    })
    assert.equal(checkoutResponse.status, 201)
    const checkoutSale = await checkoutResponse.json()
    assert.equal(checkoutSale.customer, client.name)
    assert.equal(checkoutSale.total, 50)
    assert.equal(checkoutSale.items.length, 2)

    const failedCheckout = await call('/sales/checkout', {
      method: 'POST',
      cookie: authenticatedCookie,
      body: JSON.stringify({
        method: 'PIX',
        items: [
          { inventoryId: item.id, quantity: 1 },
          { inventoryId: secondItem.id, quantity: 2 },
        ],
      }),
    })
    assert.equal(failedCheckout.status, 400)
    const afterFailedCheckout = await call('/state', { cookie: authenticatedCookie })
    const afterFailedState = await afterFailedCheckout.json()
    assert.equal(afterFailedState.inventory.find((entry) => entry.id === item.id).stock, 0)
    assert.equal(afterFailedState.inventory.find((entry) => entry.id === secondItem.id).stock, 1)

    const stockBeforeWalkIn = await call(`/inventory/${item.id}/stock`, {
      method: 'POST',
      cookie: authenticatedCookie,
      body: JSON.stringify({ quantity: 1, unitCost: 8, note: 'Reposição para venda de teste' }),
    })
    assert.equal(stockBeforeWalkIn.status, 200)

    const walkInCheckout = await call('/sales/checkout', {
      method: 'POST',
      cookie: authenticatedCookie,
      body: JSON.stringify({
        customer: '',
        method: 'Dinheiro',
        items: [{ inventoryId: item.id, quantity: 1 }],
      }),
    })
    assert.equal(walkInCheckout.status, 201)
    assert.equal((await walkInCheckout.json()).customer, '')
    const afterWalkInCheckout = await call('/state', { cookie: authenticatedCookie })
    const afterWalkInState = await afterWalkInCheckout.json()
    assert.equal(afterWalkInState.inventory.find((entry) => entry.id === item.id).stock, 0)
    assert.equal(afterWalkInState.inventory.find((entry) => entry.id === secondItem.id).stock, 1)
    assert.equal(afterWalkInState.sales.length, 3)
    assert.equal(afterWalkInState.finance.vendas, 110)
    assert.equal(afterWalkInState.finance.despesas, 58)

    const updatedClientResponse = await call(`/clients/${client.id}`, {
      method: 'PATCH',
      cookie: authenticatedCookie,
      body: JSON.stringify({ name: 'Cliente atualizado', city: 'Santa Vitória do Palmar' }),
    })
    assert.equal(updatedClientResponse.status, 200)
    assert.equal((await updatedClientResponse.json()).name, 'Cliente atualizado')

    const updatedDeviceResponse = await call(`/devices/${device.id}`, {
      method: 'PATCH',
      cookie: authenticatedCookie,
      body: JSON.stringify({ color: 'Preto' }),
    })
    assert.equal(updatedDeviceResponse.status, 200)
    assert.equal((await updatedDeviceResponse.json()).color, 'Preto')

    const deleteClientResponse = await call(`/clients/${client.id}`, {
      method: 'DELETE',
      cookie: authenticatedCookie,
    })
    assert.equal(deleteClientResponse.status, 200)
    const detachedStateResponse = await call('/state', { cookie: authenticatedCookie })
    const detachedState = await detachedStateResponse.json()
    assert.equal(detachedState.clients.length, 0)
    assert.equal(detachedState.devices[0].ownerId, '')
    assert.equal(detachedState.devices[0].ownerName, 'Cliente atualizado')

    const blockedInventoryDelete = await call(`/inventory/${item.id}`, {
      method: 'DELETE',
      cookie: authenticatedCookie,
    })
    assert.equal(blockedInventoryDelete.status, 409)
    assert.match((await blockedInventoryDelete.json()).error, /ordem de serviço/)

    const deleteOrderResponse = await call(`/orders/${order.id}`, {
      method: 'DELETE',
      cookie: authenticatedCookie,
    })
    assert.equal(deleteOrderResponse.status, 200)
    const orderDeletedStateResponse = await call('/state', { cookie: authenticatedCookie })
    const orderDeletedState = await orderDeletedStateResponse.json()
    assert.deepEqual(orderDeletedState.devices[0].history, [])
    assert.equal(orderDeletedState.inventory.find((entry) => entry.id === item.id).stock, 2)

    const deleteDeviceResponse = await call(`/devices/${device.id}`, {
      method: 'DELETE',
      cookie: authenticatedCookie,
    })
    assert.equal(deleteDeviceResponse.status, 200)
    const deletedStateResponse = await call('/state', { cookie: authenticatedCookie })
    const deletedState = await deletedStateResponse.json()
    assert.equal(deletedState.devices.length, 0)
    assert.equal(deletedState.orders.length, 0)
    assert.equal(deletedState.inventory.find((entry) => entry.id === item.id).stock, 2)

    const deleteInventoryResponse = await call(`/inventory/${item.id}`, {
      method: 'DELETE',
      cookie: authenticatedCookie,
    })
    assert.equal(deleteInventoryResponse.status, 200)
    const deletedInventoryStateResponse = await call('/state', { cookie: authenticatedCookie })
    const deletedInventoryState = await deletedInventoryStateResponse.json()
    assert.equal(deletedInventoryState.inventory.some((entry) => entry.id === item.id), false)
    assert.equal(deletedInventoryState.sales.length, 3)

    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    restartedServer = createApp({
      db,
      appUsername: 'richer',
      initialPassword: '1020304050',
      sessionSecret: 'a-session-secret-with-more-than-thirty-two-characters',
    }).listen(0)
    await once(restartedServer, 'listening')
    const restartedStateResponse = await fetch(`http://127.0.0.1:${restartedServer.address().port}/api/state`, {
      headers: { Cookie: authenticatedCookie },
    })
    assert.equal(restartedStateResponse.status, 200)
    assert.equal((await restartedStateResponse.json()).sales.length, 3)

    const changedPasswordLogin = await fetch(`http://127.0.0.1:${restartedServer.address().port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'richer', password: 'a-strong-new-test-password' }),
    })
    assert.equal(changedPasswordLogin.status, 200)
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
    if (restartedServer?.listening) {
      await new Promise((resolve, reject) => {
        restartedServer.close((error) => (error ? reject(error) : resolve()))
      })
    }
    await db.close()
  }
})
