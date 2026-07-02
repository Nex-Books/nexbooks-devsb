'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Badge, Box, Button, Flex, Grid, Icon, Input, InputGroup, InputLeftElement,
  Skeleton, Table, Tbody, Td, Text, Th, Thead, Tr,
  Stat, StatLabel, StatNumber, StatHelpText, Select,
} from '@chakra-ui/react';
import {
  MdAccountBalance, MdFilterList, MdRefresh, MdSearch,
  MdTrendingDown, MdTrendingUp,
} from 'react-icons/md';
import { supabase } from 'lib/supabase';
import { useAuth } from 'context/AuthContext';

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:8000';

const CARD_SHADOW = '0px 18px 40px rgba(112,144,176,0.12)';
const TEXT_DARK = '#1B2559';
const TEXT_MUTED = '#AEB2B9';
const TEXT_BODY = '#676C73';
const BORDER = '#E3E5EA';
const PAGE_BG = '#FCFCFD';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);

interface LedgerRow {
  id: string;
  journal_entry_id: string;
  entry_date: string;
  description: string;
  reference_number?: string;
  debit: number;
  credit: number;
  narration?: string;
  running_balance: number;
  account_type?: string;
}

interface AccountOption {
  account_code: string;
  account_name: string;
  account_type: string;
}

export default function LedgerPage() {
  const { user } = useAuth();

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [closingBalance, setClosingBalance] = useState(0);
  const [accountType, setAccountType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  // Load chart of accounts for the dropdown
  useEffect(() => {
    if (!user) return;
    async function loadAccounts() {
      try {
        const { data } = await supabase
          .from('chart_of_accounts')
          .select('account_code, account_name, account_type')
          .eq('is_active', true)
          .order('account_type')
          .order('account_name');
        setAccounts(data || []);
        if (data && data.length > 0) {
          setSelectedAccount(data[0].account_name);
        }
      } catch {
        // Fallback: load from journal_lines to derive accounts used
        const { data } = await supabase
          .from('journal_lines')
          .select('account_name, account_type')
          .order('account_name');
        const unique = Array.from(
          new Map((data || []).map((r: any) => [r.account_name, r])).values()
        ) as AccountOption[];
        setAccounts(unique);
        if (unique.length > 0) setSelectedAccount(unique[0].account_name);
      } finally {
        setAccountsLoading(false);
      }
    }
    loadAccounts();
  }, [user]);

  const fetchLedger = useCallback(async () => {
    if (!selectedAccount || !user) return;
    setLoading(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const params = new URLSearchParams({ account_name: selectedAccount });
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);

      const res = await fetch(`${API}/api/journal-entries/account/ledger?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch ledger');
      const json = await res.json();
      setRows(json.data || []);
      setClosingBalance(json.closing_balance || 0);
      setAccountType(json.account_type || '');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, dateFrom, dateTo, user]);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  const filtered = rows.filter(r =>
    !searchTerm ||
    r.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.narration?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.reference_number?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Rows arrive from the backend oldest-first (required for the running
  // balance to be correct). For display only, "newest" reverses that order
  // without touching the underlying running_balance values.
  const displayRows = sortOrder === 'newest' ? [...filtered].reverse() : filtered;

  const totalDebit = filtered.reduce((s, r) => s + (r.debit || 0), 0);
  const totalCredit = filtered.reduce((s, r) => s + (r.credit || 0), 0);

  // Group accounts by type for optgroup
  const accountsByType: Record<string, AccountOption[]> = {};
  accounts.forEach(a => {
    if (!accountsByType[a.account_type]) accountsByType[a.account_type] = [];
    accountsByType[a.account_type].push(a);
  });

  const balanceColor = closingBalance >= 0 ? '#01B574' : '#EE5D50';

  return (
    <Box bg={PAGE_BG} minH="100%" p={{ base: '16px', md: '28px' }}>
      {/* Header */}
      <Flex justify="space-between" align="center" mb="24px" flexWrap="wrap" gap="12px">
        <Box>
          <Text fontSize="2xl" fontWeight="800" color={TEXT_DARK} letterSpacing="-0.6px">
            General Ledger
          </Text>
          <Text fontSize="sm" color={TEXT_MUTED} mt="2px">
            Account-wise transaction history with running balance
          </Text>
        </Box>
        <Button
          leftIcon={<MdRefresh />}
          onClick={fetchLedger}
          size="sm"
          colorScheme="green"
          borderRadius="10px"
          isLoading={loading}
        >
          Refresh
        </Button>
      </Flex>

      {/* Filters */}
      <Box bg="white" borderRadius="16px" boxShadow={CARD_SHADOW} p="20px" mb="20px">
        <Flex gap="12px" flexWrap="wrap" align="flex-end">
          <Box flex="2" minW="200px">
            <Text fontSize="xs" fontWeight="700" color={TEXT_MUTED} mb="6px" letterSpacing="0.5px" textTransform="uppercase">
              Account
            </Text>
            {accountsLoading ? (
              <Skeleton h="40px" borderRadius="8px" />
            ) : (
              <Select
                value={selectedAccount}
                onChange={e => setSelectedAccount(e.target.value)}
                borderRadius="10px"
                fontSize="sm"
                size="md"
              >
                {Object.entries(accountsByType).map(([type, accs]) => (
                  <optgroup key={type} label={type}>
                    {accs.map(a => (
                      <option key={a.account_name} value={a.account_name}>
                        {a.account_code ? `[${a.account_code}] ` : ''}{a.account_name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Box>

          <Box flex="1" minW="140px">
            <Text fontSize="xs" fontWeight="700" color={TEXT_MUTED} mb="6px" letterSpacing="0.5px" textTransform="uppercase">From Date</Text>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} borderRadius="10px" fontSize="sm" size="md" />
          </Box>

          <Box flex="1" minW="140px">
            <Text fontSize="xs" fontWeight="700" color={TEXT_MUTED} mb="6px" letterSpacing="0.5px" textTransform="uppercase">To Date</Text>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} borderRadius="10px" fontSize="sm" size="md" />
          </Box>

          <Box flex="2" minW="200px">
            <Text fontSize="xs" fontWeight="700" color={TEXT_MUTED} mb="6px" letterSpacing="0.5px" textTransform="uppercase">Search</Text>
            <InputGroup size="md">
              <InputLeftElement pointerEvents="none">
                <Icon as={MdSearch} color={TEXT_MUTED} w="16px" h="16px" />
              </InputLeftElement>
              <Input
                placeholder="Search description / narration..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                borderRadius="10px"
                fontSize="sm"
                pl="36px"
              />
            </InputGroup>
          </Box>

          <Box flex="1" minW="160px">
            <Text fontSize="xs" fontWeight="700" color={TEXT_MUTED} mb="6px" letterSpacing="0.5px" textTransform="uppercase">
              Sort
            </Text>
            <Select
              value={sortOrder}
              onChange={e => setSortOrder(e.target.value as 'newest' | 'oldest')}
              borderRadius="10px"
              fontSize="sm"
              size="md"
            >
              <option value="newest">Recent first</option>
              <option value="oldest">Oldest first</option>
            </Select>
          </Box>
        </Flex>
      </Box>

      {/* Summary Cards */}
      <Grid templateColumns={{ base: '1fr', sm: 'repeat(3, 1fr)' }} gap="16px" mb="20px">
        <Box bg="white" borderRadius="16px" boxShadow={CARD_SHADOW} p="20px">
          <Flex align="center" gap="12px">
            <Flex w="44px" h="44px" bg="linear-gradient(135deg,#E6FAF5,#B3E3CC)" borderRadius="12px" align="center" justify="center" flexShrink={0}>
              <Icon as={MdTrendingUp} w="20px" h="20px" color="#01B574" />
            </Flex>
            <Box>
              <Text fontSize="xs" color={TEXT_MUTED} fontWeight="700" textTransform="uppercase" letterSpacing="0.5px">Total Debit</Text>
              <Text fontSize="xl" fontWeight="800" color={TEXT_DARK}>{fmt(totalDebit)}</Text>
            </Box>
          </Flex>
        </Box>

        <Box bg="white" borderRadius="16px" boxShadow={CARD_SHADOW} p="20px">
          <Flex align="center" gap="12px">
            <Flex w="44px" h="44px" bg="linear-gradient(135deg,#FEEFEE,#FECACA)" borderRadius="12px" align="center" justify="center" flexShrink={0}>
              <Icon as={MdTrendingDown} w="20px" h="20px" color="#EE5D50" />
            </Flex>
            <Box>
              <Text fontSize="xs" color={TEXT_MUTED} fontWeight="700" textTransform="uppercase" letterSpacing="0.5px">Total Credit</Text>
              <Text fontSize="xl" fontWeight="800" color={TEXT_DARK}>{fmt(totalCredit)}</Text>
            </Box>
          </Flex>
        </Box>

        <Box bg="white" borderRadius="16px" boxShadow={CARD_SHADOW} p="20px">
          <Flex align="center" gap="12px">
            <Flex w="44px" h="44px" bg="linear-gradient(135deg,#EFF4FB,#C7D7F4)" borderRadius="12px" align="center" justify="center" flexShrink={0}>
              <Icon as={MdAccountBalance} w="20px" h="20px" color="#3965FF" />
            </Flex>
            <Box>
              <Text fontSize="xs" color={TEXT_MUTED} fontWeight="700" textTransform="uppercase" letterSpacing="0.5px">Closing Balance</Text>
              <Text fontSize="xl" fontWeight="800" color={balanceColor}>{fmt(closingBalance)}</Text>
              {accountType && (
                <Badge colorScheme={accountType === 'Asset' || accountType === 'Expense' ? 'blue' : 'purple'} fontSize="10px" mt="2px">
                  {accountType}
                </Badge>
              )}
            </Box>
          </Flex>
        </Box>
      </Grid>

      {/* Ledger Table */}
      <Box bg="white" borderRadius="16px" boxShadow={CARD_SHADOW} overflow="hidden">
        <Flex px="24px" pt="22px" pb="16px" justify="space-between" align="center">
          <Box>
            <Text fontWeight="700" fontSize="md" color={TEXT_DARK}>{selectedAccount || 'Select an account'}</Text>
            <Text fontSize="xs" color={TEXT_MUTED} mt="2px">{filtered.length} transactions</Text>
          </Box>
        </Flex>

        {loading ? (
          <Box px="24px" pb="24px">
            {[...Array(6)].map((_, i) => <Skeleton key={i} h="48px" mb="8px" borderRadius="8px" />)}
          </Box>
        ) : filtered.length === 0 ? (
          <Flex direction="column" align="center" py="60px" gap="12px">
            <Flex w="56px" h="56px" bg="gray.50" borderRadius="16px" align="center" justify="center">
              <Icon as={MdAccountBalance} w="28px" h="28px" color={TEXT_MUTED} />
            </Flex>
            <Text fontSize="sm" color={TEXT_BODY}>No ledger entries found for this account.</Text>
            <Text fontSize="xs" color={TEXT_MUTED}>Try adjusting the date range or selecting a different account.</Text>
          </Flex>
        ) : (
          <Box overflowX="auto">
            <Table size="sm" variant="simple">
              <Thead>
                <Tr bg={PAGE_BG}>
                  {['Date', 'Description / Narration', 'Reference', 'Debit', 'Credit', 'Balance'].map((h, i) => (
                    <Th
                      key={h}
                      px={i === 0 || i === 5 ? '24px' : '12px'}
                      isNumeric={i >= 3}
                      fontSize="10px" color={TEXT_MUTED} fontWeight="700"
                      letterSpacing="0.7px" borderColor={BORDER} textTransform="uppercase" py="14px"
                    >
                      {h}
                    </Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {displayRows.map((row) => (
                  <Tr key={row.id} _hover={{ bg: PAGE_BG }}>
                    <Td px="24px" borderColor={BORDER} py="12px" whiteSpace="nowrap">
                      <Text fontSize="xs" color={TEXT_BODY} fontFamily="mono">
                        {new Date(row.entry_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </Text>
                    </Td>
                    <Td borderColor={BORDER} px="12px" maxW="280px">
                      <Text fontSize="sm" color={TEXT_DARK} fontWeight="500" noOfLines={1}>{row.description}</Text>
                      {row.narration && row.narration !== row.description && (
                        <Text fontSize="xs" color={TEXT_MUTED} noOfLines={1}>{row.narration}</Text>
                      )}
                    </Td>
                    <Td borderColor={BORDER} px="12px">
                      <Text fontSize="xs" color={TEXT_BODY} fontFamily="mono">{row.reference_number || '—'}</Text>
                    </Td>
                    <Td isNumeric borderColor={BORDER} px="12px">
                      <Text fontSize="sm" fontWeight="600" color={row.debit > 0 ? '#01B574' : TEXT_MUTED} fontFamily="mono">
                        {row.debit > 0 ? fmt(row.debit) : '—'}
                      </Text>
                    </Td>
                    <Td isNumeric borderColor={BORDER} px="12px">
                      <Text fontSize="sm" fontWeight="600" color={row.credit > 0 ? '#EE5D50' : TEXT_MUTED} fontFamily="mono">
                        {row.credit > 0 ? fmt(row.credit) : '—'}
                      </Text>
                    </Td>
                    <Td isNumeric px="24px" borderColor={BORDER}>
                      <Text
                        fontSize="sm" fontWeight="700" fontFamily="mono"
                        color={row.running_balance >= 0 ? '#3965FF' : '#EE5D50'}
                      >
                        {fmt(Math.abs(row.running_balance))}
                        <Text as="span" fontSize="10px" fontWeight="500" ml="4px" color={TEXT_MUTED}>
                          {row.running_balance >= 0 ? 'Dr' : 'Cr'}
                        </Text>
                      </Text>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>

            {/* Totals Row */}
            <Flex px="24px" py="14px" borderTop="2px solid" borderColor={BORDER} bg={PAGE_BG} justify="flex-end" gap="48px">
              <Text fontSize="sm" fontWeight="700" color={TEXT_DARK}>Totals:</Text>
              <Text fontSize="sm" fontWeight="700" color="#01B574" fontFamily="mono" minW="120px" textAlign="right">{fmt(totalDebit)}</Text>
              <Text fontSize="sm" fontWeight="700" color="#EE5D50" fontFamily="mono" minW="120px" textAlign="right">{fmt(totalCredit)}</Text>
              <Text fontSize="sm" fontWeight="800" color={balanceColor} fontFamily="mono" minW="120px" textAlign="right">{fmt(Math.abs(closingBalance))}</Text>
            </Flex>
          </Box>
        )}
      </Box>
    </Box>
  );
}
