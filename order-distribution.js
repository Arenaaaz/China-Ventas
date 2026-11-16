(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OrderDistribution = api;
})(globalThis, function() {
  const amount = value => Number(value) || 0;

  function saleCost(sale, product, order, saleRevenue) {
    if (sale.productCost != null) return {unitCost: amount(sale.productCost), resolved: true};
    if (product) return {unitCost: amount(product.cost), resolved: true};

    if (order && Array.isArray(order.items)) {
      const matchingItems = order.items.filter(item =>
        sale.productId && item.productId === sale.productId
        || sale.productName && item.name === sale.productName
      );
      const item = matchingItems.length === 1
        ? matchingItems[0]
        : order.items.length === 1 ? order.items[0] : null;
      if (item && item.landedUnitCost != null) {
        return {unitCost: amount(item.landedUnitCost), resolved: true};
      }
      if (item && item.unitCost != null) {
        const quantity = amount(item.qty) || 1;
        const shippingPerUnit = item.shippingAllocated != null
          ? amount(item.shippingAllocated) / quantity
          : amount(order.shippingPerUnit);
        return {unitCost: amount(item.unitCost) + shippingPerUnit, resolved: true};
      }
    }

    if (order && !Array.isArray(order.items)) {
      const legacyCost = amount(order.qty) * amount(order.unitCost) + amount(order.fInt) + amount(order.fNat);
      return {unitCost: legacyCost / (amount(order.qty) || 1), resolved: true};
    }

    return {unitCost: saleRevenue / (amount(sale.qty) || 1), resolved: false};
  }

  function calculate({orders, sales, products, expenses, partnerShares, pool, companyProfit}) {
    const orderGroups = orders.map(order => {
      const legacyCost = amount(order.qty) * amount(order.unitCost) + amount(order.fInt) + amount(order.fNat);
      return {
        id: order.id,
        kind: 'order',
        name: order.name || 'Pedido',
        date: order.date || '',
        purchaseCost: Array.isArray(order.items) ? amount(order.totalCost) : legacyCost,
        contributions: Array.isArray(order.contributions) ? order.contributions : [],
        revenue: 0,
        costOfGoodsSold: 0,
        unitsSold: 0,
        expenses: 0,
        netProfit: 0,
        payoutProfit: 0,
        workPool: 0,
        capitalPool: 0,
        partners: []
      };
    });
    const groupsById = new Map(orderGroups.map(group => [group.id, group]));
    const productsById = new Map(products.map(product => [product.id, product]));
    let unassignedSales = null;
    let uncostedSales = 0;

    for (const sale of sales) {
      let product = productsById.get(sale.productId);
      let order = groupsById.get(sale.orderId);
      if (!order && product) {
        order = groupsById.get(product.orderId);
        if (!order) order = orderGroups.find(group => {
          const record = orders.find(item => item.id === group.id);
          return Array.isArray(record && record.items) && record.items.some(item => item.productId === product.id);
        });
      }
      if (!product && order) {
        const record = orders.find(item => item.id === order.id);
        if (record && Array.isArray(record.items)) {
          const matchingItems = record.items.filter(item => sale.productName && item.name === sale.productName);
          const item = matchingItems.length === 1 ? matchingItems[0] : record.items.length === 1 ? record.items[0] : null;
          if (item) product = productsById.get(item.productId);
        }
      }

      const group = order || (unassignedSales ||= {
        id: 'unassigned-sales',
        kind: 'unassigned-sales',
        name: 'Ventas sin pedido asociado',
        date: '',
        purchaseCost: 0,
        contributions: [],
        revenue: 0,
        costOfGoodsSold: 0,
        unitsSold: 0,
        expenses: 0,
        netProfit: 0,
        payoutProfit: 0,
        workPool: 0,
        capitalPool: 0,
        partners: []
      });
      const orderRecord = order && orders.find(item => item.id === order.id);
      const quantity = amount(sale.qty);
      const saleRevenue = amount(sale.total) || amount(sale.unitPrice) * quantity || (product ? amount(product.price) * quantity : 0);
      group.revenue += saleRevenue;
      group.unitsSold += quantity;
      const cost = saleCost(sale, product, orderRecord, saleRevenue);
      group.costOfGoodsSold += quantity * cost.unitCost;
      if (!cost.resolved) uncostedSales++;
    }

    const groups = orderGroups.slice();
    if (unassignedSales) groups.push(unassignedSales);
    const revenue = groups.reduce((sum, group) => sum + group.revenue, 0);
    const totalExpenses = expenses.reduce((sum, expense) => sum + amount(expense.amount), 0);

    if (revenue > 0) {
      groups.forEach(group => {
        group.expenses = totalExpenses * group.revenue / revenue;
        group.netProfit = group.revenue - group.costOfGoodsSold - group.expenses;
      });
    } else if (totalExpenses > 0) {
      groups.push({
        id: 'unassigned-expenses',
        kind: 'unassigned-expenses',
        name: 'Gastos sin ventas asociadas',
        date: '',
        purchaseCost: 0,
        contributions: [],
        revenue: 0,
        costOfGoodsSold: 0,
        unitsSold: 0,
        expenses: totalExpenses,
        netProfit: -totalExpenses,
        payoutProfit: 0,
        workPool: 0,
        capitalPool: 0,
        partners: []
      });
    }

    const calculatedProfit = groups.reduce((sum, group) => sum + group.netProfit, 0);
    const historicalProfit = Number.isFinite(companyProfit) ? companyProfit : calculatedProfit;
    const positiveProfit = groups.reduce((sum, group) => sum + Math.max(0, group.netProfit), 0);
    const totalPoints = partnerShares.reduce((sum, partner) => sum + amount(partner.points), 0);
    const poolRate = Math.min(100, Math.max(0, amount(pool))) / 100;
    const allPartners = new Map(partnerShares.map(partner => [partner.id, {
      ...partner,
      capitalPayout: 0,
      pointsPayout: 0,
      totalPayout: 0,
      invested: 0
    }]));

    groups.forEach(group => group.contributions.forEach(item => {
      if (!allPartners.has(item.partnerId)) {
        allPartners.set(item.partnerId, {
          id: item.partnerId,
          name: 'Socio no registrado',
          capitalPct: 0,
          pointsPct: 0,
          points: 0,
          capitalPayout: 0,
          pointsPayout: 0,
          totalPayout: 0,
          invested: 0
        });
      }
    }));

    for (const group of groups) {
      if (uncostedSales === 0 && historicalProfit > 0 && positiveProfit > 0 && group.netProfit > 0) {
        group.payoutProfit = historicalProfit * group.netProfit / positiveProfit;
        group.workPool = totalPoints > 0 ? group.payoutProfit * poolRate : 0;
        group.capitalPool = group.payoutProfit - group.workPool;
      }

      const contributed = new Map();
      group.contributions.forEach(item => {
        const key = item.partnerId;
        const current = contributed.get(key) || 0;
        contributed.set(key, current + amount(item.amount));
      });
      const contributionTotal = [...contributed.values()].reduce((sum, value) => sum + value, 0);
      group.estimatedCapitalSplit = contributionTotal <= 0;
      group.partners = [...allPartners.values()].map(partner => {
        const invested = contributed.get(partner.id) || 0;
        const capitalPct = contributionTotal > 0 ? invested / contributionTotal : amount(partner.capitalPct);
        const capitalPayout = group.capitalPool * capitalPct;
        const pointsPayout = group.workPool * amount(partner.pointsPct);
        const totalPayout = capitalPayout + pointsPayout;
        partner.invested += invested;
        partner.capitalPayout += capitalPayout;
        partner.pointsPayout += pointsPayout;
        partner.totalPayout += totalPayout;
        return {
          id: partner.id,
          name: partner.name,
          invested,
          capitalPct,
          capitalPayout,
          pointsPct: amount(partner.pointsPct),
          pointsPayout,
          totalPayout
        };
      });
    }

    return {
      groups,
      historicalProfit,
      calculatedProfit,
      totalRevenue: groups.reduce((sum, group) => sum + group.revenue, 0),
      totalCostOfGoodsSold: groups.reduce((sum, group) => sum + group.costOfGoodsSold, 0),
      totalExpenses,
      totalPayout: groups.reduce((sum, group) => sum + group.payoutProfit, 0),
      uncostedSales,
      partners: [...allPartners.values()]
    };
  }

  return {calculate, saleCost};
});
