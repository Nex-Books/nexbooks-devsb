'use client';

import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Badge, Box, Button, Flex, Grid, Icon, Input, Select,
  Skeleton, Table, Tbody, Td, Text, Th, Thead, Tr,
} from '@chakra-ui/react';
import {
  MdMoneyOff, MdRefresh, MdTrendingDown, MdAddCircleOutline,
} from 'react-icons/md';
import { RiRobot2Line } from 'react-icons/ri';
import { supabase } from 'lib/supabase';
import { useAuth } from 'context/AuthContext';

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false });

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:8000';


const CARD_SHADOW = '0px 18px 40px rgba(112,144,176,0.12)';
const TEXT_DARK = '#1B2559';
const TEXT_MUTED = '#AEB2B9';
const TEXT_BODY = '#676C73';
const BORDER = '#E3E5EA';
const PAGE_BG = '#FCFCFD';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

interface ExpenseEntry {
  id: string;
  entry_date: string;
  description: string;
  total_amount: number;
  transaction_type: string;
  source?: string;
  ai_generated?: boolean;
  journal_lines?: { account_name: string; account_type: string; debit: number; credit: number }[];
}


const EXPENSE_COLORS = [
  '#3965FF', '#7551FF', '#EE5D50', '#FFB547', '#01B574',
  '#68B5FB', '#A27FFF', '#F79862', '#44CC97',
];

export default function ExpensesPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  // Get 1st day of current month as default from
  useEffect(() => {
    const now = new Date();
    setDateFrom(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
    setDateTo(new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]);
  }, []);

  const getAuthHeader = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  }, []);

  const fetchExpenses = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await getAuthHeader();
      const params = new URLSearchParams({
        user_id: user.id,
        limit: '500',
        status: 'posted',
        ...(dateFrom && { date_from: dateFrom }),
        ...(dateTo && { date_to: dateTo }),
      });
      const res = await fetch(`${API}/api/journal-entries?${params}`, { headers });
      const data = await res.json();
      
      const all = (data.data || []).map((e: any) => ({
        ...e,
        journal_lines: e.lines || [],
      }));

      // Filter for expense transactions only
      const expensesOnly = all.filter((e: any) => e.transaction_type === 'expense');
      setEntries(expensesOnly);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user, dateFrom, dateTo, getAuthHeader]);

  useEffect(() => { if (dateFrom && dateTo) fetchExpenses(); }, [fetchExpenses, dateFrom, dateTo]);

  const filtered = entries.filter(e => {
    const matchSearch = !search || e.description.toLowerCase().includes(search.toLowerCase());
    const matchSource = !sourceFilter || e.source === sourceFilter;
    return matchSearch && matchSource;
  });

  const totalExpenses = filtered.reduce((s, e) => s + (e.total_amount || 0), 0);

  // Category breakdown — from expense journal lines
  const byCategory: Record<string, number> = {};
  filtered.forEach(entry => {
    (entry.journal_lines || []).forEach(line => {
      if (line.account_type === 'Expense' && line.debit > 0) {
        byCategory[line.account_name] = (byCategory[line.account_name] || 0) + line.debit;
      }
    });
    // If no lines available, use entry itself
    if (!entry.journal_lines?.length) {
      byCategory['Uncategorized'] = (byCategory['Uncategorized'] || 0) + entry.total_amount;
    }
  });


  const categoryLabels = Object.keys(byCategory);
  const categoryValues = Object.values(byCategory);

  // Monthly trend
  const monthlyTrend: Record<string, number> = {};
  filtered.forEach(e => {
    const key = e.entry_date.slice(0, 7); // YYYY-MM
    monthlyTrend[key] = (monthlyTrend[key] || 0) + e.total_amount;
  });
  const trendMonths = Object.keys(monthlyTrend).sort();
  const trendValues = trendMonths.map(m => monthlyTrend[m]);
  const trendLabels = trendMonths.map(m => {
    const [y, mo] = m.split('-');
    return new Date(parseInt(y), parseInt(mo) - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' });
  });

  return (
    <Box bg={PAGE_BG} minH="100%" p={{ base: '16px', md: '28px' }}>
      {/* Header */}
      <Flex justify="space-between" align="center" mb="24px" flexWrap="wrap" gap="12px">
        <Box>
          <Text fontSize="2xl" fontWeight="800" color={TEXT_DARK} letterSpacing="-0.6px">Expenses</Text>
          <Text fontSize="sm" color={TEXT_MUTED} mt="2px">Track and analyze all business expenses</Text>
        </Box>
        <Flex gap="10px">
          <Button leftIcon={<MdRefresh />} onClick={fetchExpenses} size="sm" variant="outline" borderRadius="10px" isLoading={loading}>Refresh</Button>
          <Link href="/app/ai-assistant">
            <Button leftIcon={<RiRobot2Line />} size="sm" colorScheme="green" borderRadius="10px">Record Expense</Button>
          </Link>
        </Flex>
      </Flex>

      {/* Filters */}
      <Box bg="white" borderRadius="16px" boxShadow={CARD_SHADOW} p="20px" mb="20px">
        <Flex gap="12px" flexWrap="wrap" align="flex-end">
          <Box flex="2" minW="180px">
            <Text fontSize="xs" fontWeight="700" color={TEXT_MUTED} mb="6px" textTransform="uppercase" letterSpacing="0.5px">Search</Text>
            <Input placeholder="Search description..." value={search} onChange={e => setSearch(e.target.value)} borderRadius="10px" fontSize="sm" size="md" />
          </Box>
          <Box flex="1" minW="130px">
            <Text fontSize="xs" fontWeight="700" color={TEXT_MUTED} mb="6px" textTransform="uppercase" letterSpacing="0.5px">From</Text>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} borderRadius="10px" fontSize="sm" size="md" />
          </Box>
          <Box flex="1" minW="130px">
            <Text fontSize="xs" fontWeight="700" color={TEXT_MUTED} mb="6px" textTransform="uppercase" letterSpacing="0.5px">To</Text>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} borderRadius="10px" fontSize="sm" size="md" />
          </Box>
          <Box flex="1" minW="130px">
            <Text fontSize="xs" fontWeight="700" color={TEXT_MUTED} mb="6px" textTransform="uppercase" letterSpacing="0.5px">Source</Text>
            <Select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} borderRadius="10px" fontSize="sm" size="md">
              <option value="">All Sources</option>
              <option value="chat">AI Chat</option>
              <option value="invoice_upload">Invoice Upload</option>
              <option value="manual">Manual</option>
            </Select>
          </Box>
        </Flex>
      </Box>

      {/* KPI + Charts Row */}
      <Grid templateColumns={{ base: '1fr', lg: '200px 1fr 1fr' }} gap="20px" mb="24px">
        {/* Total Card */}
        <Box bg="white" borderRadius="16px" boxShadow={CARD_SHADOW} p="20px" display="flex" flexDirection="column" justifyContent="center">
          <Flex w="44px" h="44px" bg="linear-gradient(135deg,#FEEFEE,#FECACA)" borderRadius="12px" align="center" justify="center" mb="12px">
            <Icon as={MdTrendingDown} w="22px" h="22px" color="#EE5D50" />
          </Flex>
          <Text fontSize="xs" color={TEXT_MUTED} fontWeight="700" textTransform="uppercase" letterSpacing="0.5px" mb="4px">Total Expenses</Text>
          {loading ? <Skeleton h="28px" w="100px" /> : (
            <Text fontSize="2xl" fontWeight="800" color="#EE5D50">{fmt(totalExpenses)}</Text>
          )}
          <Text fontSize="xs" color={TEXT_MUTED} mt="4px">{filtered.length} transactions</Text>
        </Box>

        {/* Pie Chart */}
        <Box bg="white" borderRadius="16px" boxShadow={CARD_SHADOW} p="24px">
          <Text fontWeight="700" fontSize="md" color={TEXT_DARK} mb="4px">Category Breakdown</Text>
          <Text fontSize="xs" color={TEXT_MUTED} mb="12px">Expenses by account category</Text>
          {loading ? <Skeleton h="200px" borderRadius="12px" /> : categoryLabels.length === 0 ? (
            <Flex align="center" justify="center" h="160px">
              <Text fontSize="sm" color={TEXT_BODY}>No expense data.</Text>
            </Flex>
          ) : (
            <Chart
              options={{
                chart: { type: 'donut', fontFamily: 'DM Sans, sans-serif' },
                labels: categoryLabels,
                colors: EXPENSE_COLORS,
                legend: { position: 'bottom', fontSize: '12px', labels: { colors: TEXT_BODY } },
                dataLabels: { enabled: false },
                plotOptions: { pie: { donut: { size: '60%' } } },
                tooltip: { y: { formatter: (v: number) => fmt(v) } },
              }}
              series={categoryValues}
              type="donut" height={200} width="100%"
            />
          )}
        </Box>

        {/* Bar Chart */}
        <Box bg="white" borderRadius="16px" boxShadow={CARD_SHADOW} p="24px">
          <Text fontWeight="700" fontSize="md" color={TEXT_DARK} mb="4px">Monthly Trend</Text>
          <Text fontSize="xs" color={TEXT_MUTED} mb="12px">Expense trend over time</Text>
          {loading ? <Skeleton h="200px" borderRadius="12px" /> : trendLabels.length === 0 ? (
            <Flex align="center" justify="center" h="160px">
              <Text fontSize="sm" color={TEXT_BODY}>No trend data.</Text>
            </Flex>
          ) : (
            <Chart
              options={{
                chart: { type: 'bar', toolbar: { show: false }, fontFamily: 'DM Sans, sans-serif' },
                xaxis: { categories: trendLabels, labels: { style: { colors: TEXT_MUTED, fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
                yaxis: { labels: { formatter: (v: number) => `₹${Number(v).toLocaleString('en-IN')}`, style: { colors: TEXT_MUTED } } },
                colors: ['#EE5D50'],
                plotOptions: { bar: { borderRadius: 6, columnWidth: '55%' } },
                dataLabels: { enabled: false },
                grid: { borderColor: BORDER, strokeDashArray: 4 },
                tooltip: { y: { formatter: (v: number) => fmt(v) } },
              }}
              series={[{ name: 'Expenses', data: trendValues }]}
              type="bar" height={200} width="100%"
            />
          )}
        </Box>
      </Grid>

      {/* Expense Table */}
      <Box bg="white" borderRadius="16px" boxShadow={CARD_SHADOW} overflow="hidden">
        <Flex px="24px" pt="22px" pb="16px" align="center">
          <Text fontWeight="700" fontSize="md" color={TEXT_DARK} flex="1">Expense Transactions</Text>
          <Text fontSize="xs" color={TEXT_MUTED}>{filtered.length} entries</Text>
        </Flex>

        {loading ? (
          <Box px="24px" pb="24px">{[...Array(5)].map((_, i) => <Skeleton key={i} h="48px" mb="8px" borderRadius="8px" />)}</Box>
        ) : filtered.length === 0 ? (
          <Flex direction="column" align="center" py="60px" gap="12px">
            <Flex w="56px" h="56px" bg="red.50" borderRadius="16px" align="center" justify="center">
              <Icon as={MdMoneyOff} w="28px" h="28px" color="red.300" />
            </Flex>
            <Text fontSize="sm" color={TEXT_BODY}>No expense entries in this period.</Text>
            <Link href="/app/ai-assistant">
              <Button size="sm" leftIcon={<RiRobot2Line />} colorScheme="green" borderRadius="10px">Record via AI</Button>
            </Link>
          </Flex>
        ) : (
          <Box overflowX="auto">
            <Table size="sm" variant="simple">
              <Thead>
                <Tr bg={PAGE_BG}>
                  {['Date', 'Description', 'Category', 'Amount', 'Source'].map((h, i) => (
                    <Th key={h} px={i === 0 || i === 4 ? '24px' : '12px'} isNumeric={i === 3}
                      fontSize="10px" color={TEXT_MUTED} fontWeight="700" letterSpacing="0.7px"
                      borderColor={BORDER} textTransform="uppercase" py="14px">{h}</Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {filtered.map(e => {
                  const expLine = e.journal_lines?.find(l => l.account_type === 'Expense' && l.debit > 0);
                  const category = expLine?.account_name || 'Expense';
                  return (
                    <Tr key={e.id} _hover={{ bg: PAGE_BG }}>
                      <Td px="24px" borderColor={BORDER} py="12px" whiteSpace="nowrap">
                        <Text fontSize="xs" color={TEXT_BODY} fontFamily="mono">
                          {new Date(e.entry_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </Text>
                      </Td>
                      <Td borderColor={BORDER} px="12px" maxW="260px">
                        <Text fontSize="sm" color={TEXT_DARK} fontWeight="500" noOfLines={1}>{e.description}</Text>
                      </Td>
                      <Td borderColor={BORDER} px="12px">
                        <Badge colorScheme="red" variant="subtle" borderRadius="6px" fontSize="10px">{category}</Badge>
                      </Td>
                      <Td isNumeric borderColor={BORDER} px="12px">
                        <Text fontSize="sm" fontWeight="700" color="#EE5D50" fontFamily="mono">−{fmt(e.total_amount)}</Text>
                      </Td>
                      <Td px="24px" borderColor={BORDER}>
                        <Flex display="inline-flex" align="center" gap="4px" px="7px" py="3px"
                          bg={e.ai_generated ? '#E6FAF5' : '#F5F5F6'} borderRadius="6px">
                          <Icon as={e.ai_generated ? RiRobot2Line : MdAddCircleOutline} w="10px" h="10px"
                            color={e.ai_generated ? '#51BC8F' : TEXT_MUTED} />
                          <Text fontSize="10px" fontWeight="700" color={e.ai_generated ? '#51BC8F' : TEXT_MUTED}>
                            {e.source === 'chat' ? 'AI Chat' : e.source === 'invoice_upload' ? 'Invoice' : 'Manual'}
                          </Text>
                        </Flex>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </Box>
        )}
      </Box>
    </Box>
  );
}
