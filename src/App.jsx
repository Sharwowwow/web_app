import React, { useState, useEffect, useRef } from 'react';
import { Package, X, CheckCircle, PackageOpen, MapPin, Search, CheckSquare, Square, Copy, Lock } from 'lucide-react';
import './index.css';

function App() {
  const [token, setToken] = useState(localStorage.getItem('admin_token') || '');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // 'upload' | 'download'
  const fileInputRef = useRef(null);

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [checkedItemsMap, setCheckedItemsMap] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('unpackaged');
  const [copiedId, setCopiedId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [isFileMissing, setIsFileMissing] = useState(false);
  const [showBoxSelector, setShowBoxSelector] = useState(false);
  const [selectorType, setSelectorType] = useState('consolidation'); // 'consolidation' | 'ready'
  const [uploadFile, setUploadFile] = useState(null);
  const [showUploadConfirmModal, setShowUploadConfirmModal] = useState(false);

  const getAuthHeaders = (t = token) => ({
    'Authorization': `Bearer ${t}`
  });

  const handleAuthError = () => {
    setToken('');
    localStorage.removeItem('admin_token');
    setShowAuthModal(true);
  };

  const executePendingAction = (validToken) => {
    if (pendingAction === 'upload') {
      setTimeout(() => fileInputRef.current?.click(), 100);
    } else if (pendingAction === 'download') {
      window.location.href = `/api/download?token=${validToken}`;
    }
    setShowAuthModal(false);
    setPendingAction(null);
    setPasswordInput('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput })
      });
      const data = await res.json();
      if (data.success) {
        setToken(data.token);
        localStorage.setItem('admin_token', data.token);
        setLoginError('');
        executePendingAction(data.token);
      } else {
        setLoginError('密码错误，请重试');
      }
    } catch (err) {
      setLoginError('网络错误，无法登录');
    } finally {
      setLoading(false);
    }
  };

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/orders'); // No auth required for orders now
      if (res.status === 404) {
        const errorData = await res.json();
        if (errorData.code === "NO_FILE") {
          setIsFileMissing(true);
        }
        setOrders([]);
        return;
      }
      setIsFileMissing(false);
      const data = await res.json();
      setOrders(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders(); // Always fetch immediately, no token required
  }, []);

  const toggleItemStatus = (orderId, itemIndex) => {
    setCheckedItemsMap(prev => {
      const orderChecks = prev[orderId] || {};
      return {
        ...prev,
        [orderId]: {
          ...orderChecks,
          [itemIndex]: !orderChecks[itemIndex]
        }
      };
    });
  };

  const isStatusShipped = (statusStr) => {
    return statusStr && (statusStr.includes('已发货'));
  };

  const isStatusReady = (statusStr) => {
    return statusStr && statusStr.includes('已打包');
  };

  const isStatusConsolidation = (statusStr) => {
    return statusStr && statusStr.includes('待合包');
  };

  const handleStatusChange = async (order, newStatus, packedIndices = null, boxCount = 1) => {
    try {
      const res = await fetch(`/api/orders/${order.id}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          status: newStatus,
          packedIndices: packedIndices,
          boxCount: boxCount
        })
      });
      if (res.ok) {
        const data = await res.json();
        const updatedOrder = { 
          ...order, 
          status: newStatus, 
          packedIndices: data.packedIndices || [],
          boxCount: data.boxCount || 1
        };
        setOrders(orders.map(o => o.id === order.id ? updatedOrder : o));
        if (selectedOrder && selectedOrder.id === order.id) {
          setSelectedOrder(updatedOrder);
        }
        setShowBoxSelector(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fallbackCopyTextToClipboard = (text, orderId) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      const successful = document.execCommand('copy');
      if (successful) {
        setCopiedId(orderId);
        setTimeout(() => setCopiedId(null), 2000);
      } else {
        alert('当前环境无法自动复制，请手动复制');
      }
    } catch (err) {
      console.error('Fallback: Oops, unable to copy', err);
    }
    document.body.removeChild(textArea);
  };

  const handleCopyAccount = (e, orderId, accountText) => {
    e.stopPropagation();
    if (accountText) {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(accountText).then(() => {
          setCopiedId(orderId);
          setTimeout(() => setCopiedId(null), 2000);
        }).catch(() => fallbackCopyTextToClipboard(accountText, orderId));
      } else {
        fallbackCopyTextToClipboard(accountText, orderId);
      }
    }
  };

  // 真正的上传执行函数
  const executeUpload = async (file, keepStatus, currentToken) => {
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`/api/upload?keepStatus=${keepStatus}`, {
        method: 'POST',
        headers: getAuthHeaders(currentToken),
        body: formData
      });
      if (res.status === 401) return handleAuthError();
      if (res.ok) {
        await fetchOrders();
      } else {
        alert('上传失败，请重试');
      }
    } catch (e) {
      alert('网络错误：' + e.message);
    }
    setUploading(false);
  };

  // 点击上传前判断鉴权
  const handleUploadTrigger = (e) => {
    if (!token) {
      e.preventDefault(); // 阻断默认直接调起文件选择的动作
      setPendingAction('upload');
      setShowAuthModal(true);
    }
  };

  const onUploadSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = ''; // Reset input to allow re-selecting same file
    setUploadFile(file);
    setShowUploadConfirmModal(true);
  };

  // 下载操作前判断鉴权
  const handleDownloadTrigger = () => {
    if (token) {
      window.location.href = `/api/download?token=${token}`;
    } else {
      setPendingAction('download');
      setShowAuthModal(true);
    }
  };

  const shippedCount = orders.filter(o => isStatusShipped(o.status)).length;
  const readyCount = orders.filter(o => isStatusReady(o.status)).length;
  const consolidationCount = orders.filter(o => isStatusConsolidation(o.status)).length;
  const unpackedCount = orders.length - shippedCount - readyCount - consolidationCount;

  const filteredOrders = orders.filter(order => {
    const isShipped = isStatusShipped(order.status);
    const isReady = isStatusReady(order.status);
    const isConsolidation = isStatusConsolidation(order.status);
    
    if (activeTab === 'unpackaged' && (isShipped || isReady || isConsolidation)) return false;
    if (activeTab === 'consolidation' && !isConsolidation) return false;
    if (activeTab === 'ready' && !isReady) return false;
    if (activeTab === 'shipped' && !isShipped) return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    
    return (
      (order.id && order.id.toLowerCase().includes(q)) ||
      (order.accounts && order.accounts.some(acc => acc.toLowerCase().includes(q))) ||
      (order.address && order.address.toLowerCase().includes(q)) ||
      (order.status && order.status.toLowerCase().includes(q)) ||
      (order.items && order.items.some(item => item.toLowerCase().includes(q)))
    );
  });

  return (
    <div className="app-container">
      {/* 验证密码的弹窗Modal */}
      {showAuthModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
          <form onSubmit={handleLogin} style={{ background: 'var(--bg-color)', padding: '2rem', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)', width: '320px', position: 'relative' }}>
            <button type="button" onClick={() => setShowAuthModal(false)} style={{ position: 'absolute', top: '10px', right: '10px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
              <X size={20} color="var(--text-muted)" />
            </button>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <Lock size={40} color="var(--text-main)" style={{ marginBottom: '10px' }} />
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-main)' }}>请输入管理密码</h3>
              <p style={{ margin: '5px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>执行此操作需要验证管理员身份</p>
            </div>
            <input 
              type="password" 
              placeholder="管理员密码" 
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              style={{ width: '100%', padding: '10px', marginBottom: '1rem', borderRadius: '6px', border: '1px solid var(--card-border)', boxSizing: 'border-box' }}
              autoFocus
            />
            {loginError && <div style={{ color: '#e53e3e', fontSize: '0.85rem', marginBottom: '1rem', textAlign: 'center' }}>{loginError}</div>}
            <button type="submit" disabled={loading} style={{ width: '100%', padding: '10px', background: 'var(--text-main)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
              {loading ? '验证中...' : '确认并继续'}
            </button>
          </form>
        </div>
      )}

      {/* 上传确认弹窗Modal */}
      {showUploadConfirmModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ background: '#ffffff', padding: '2rem', borderRadius: '16px', boxShadow: 'var(--shadow-lg)', width: '420px', position: 'relative', textAlign: 'center' }}>
            <button type="button" onClick={() => { setShowUploadConfirmModal(false); setUploadFile(null); }} style={{ position: 'absolute', top: '15px', right: '15px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
              <X size={20} color="var(--text-muted)" />
            </button>
            <div style={{ marginBottom: '1.5rem' }}>
              <PackageOpen size={44} color="var(--color-warning)" style={{ marginBottom: '12px', margin: '0 auto' }} />
              <h3 style={{ margin: '10px 0 0', fontSize: '1.25rem', color: 'var(--text-main)', fontWeight: 700 }}>请选择上传模式</h3>
              <p style={{ margin: '8px 0 0', fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                系统检测到您正在上传表格数据，请选择是否继承之前的打包和发货进度。
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button 
                onClick={() => {
                  executeUpload(uploadFile, true, token);
                  setShowUploadConfirmModal(false);
                  setUploadFile(null);
                }} 
                style={{ width: '100%', padding: '12px', background: 'var(--color-green)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.95rem', transition: 'background 0.2s' }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#2f855a'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-green)'}
              >
                🔄 保留旧进度上传 (中途更新/追加)
              </button>
              <button 
                onClick={() => {
                  executeUpload(uploadFile, false, token);
                  setShowUploadConfirmModal(false);
                  setUploadFile(null);
                }} 
                style={{ width: '100%', padding: '12px', background: 'var(--color-red)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.95rem', transition: 'background 0.2s' }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#c53030'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-red)'}
              >
                🧹 清空并重置上传 (开启新一轮发货)
              </button>
              <button 
                onClick={() => {
                  setShowUploadConfirmModal(false);
                  setUploadFile(null);
                }} 
                style={{ width: '100%', padding: '12px', background: '#edf2f7', color: '#4a5568', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.95rem', transition: 'background 0.2s' }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#e2e8f0'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#edf2f7'}
              >
                取消上传
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 style={{ fontSize: '1.8rem', margin: 0 }}>发货管理系统</h1>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {token ? (
            <>
              <button onClick={() => { setToken(''); localStorage.removeItem('admin_token'); }} style={{ cursor: 'pointer', padding: '10px', background: 'transparent', color: 'var(--text-muted)', border: 'none', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>🔒 退出登录</span>
              </button>
              <label className="btn-upload" onClick={handleUploadTrigger} style={{ cursor: 'pointer', padding: '10px 16px', background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                {uploading ? '⏳ 上传中...' : '📤 上传单据'}
                <input ref={fileInputRef} type="file" style={{ display: 'none' }} accept=".xlsx, .xls" onChange={onUploadSelect} disabled={uploading} />
              </label>
              <button className="btn-download" onClick={handleDownloadTrigger} style={{ cursor: 'pointer', padding: '10px 16px', background: 'var(--text-main)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                📥 下载结果
              </button>
            </>
          ) : (
            <button onClick={() => { setShowAuthModal(true); setPendingAction(null); }} style={{ cursor: 'pointer', padding: '10px 16px', background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🔑 管理员登录</span>
            </button>
          )}
        </div>
      </header>


      <section className="search-section">
        <div className="search-bar">
          <Search size={20} color="var(--text-muted)" />
          <input 
            type="text" 
            placeholder="模糊搜索：淘宝账号 / 单号编号 / 商品名字 / 地址..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </section>

      <div className="tabs-container">
        <button 
          className={`tab-btn ${activeTab === 'unpackaged' ? 'active' : ''}`}
          onClick={() => setActiveTab('unpackaged')}
        >待打包 ({unpackedCount})</button>
        <button 
          className={`tab-btn ${activeTab === 'consolidation' ? 'active orange' : ''}`}
          onClick={() => setActiveTab('consolidation')}
          style={activeTab === 'consolidation' ? { background: 'var(--color-warning)', borderColor: 'var(--color-warning)' } : {}}
        >待合包 ({consolidationCount})</button>
        <button 
          className={`tab-btn ${activeTab === 'ready' ? 'active green' : ''}`}
          onClick={() => setActiveTab('ready')}
          style={activeTab === 'ready' ? { background: 'var(--color-green)', borderColor: 'var(--color-green)' } : {}}
        >已打包 ({readyCount})</button>
        <button 
          className={`tab-btn ${activeTab === 'shipped' ? 'active' : ''}`}
          onClick={() => setActiveTab('shipped')}
        >已装箱发货 ({shippedCount})</button>
        <button 
          className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >全部 ({orders.length})</button>
      </div>

      {isFileMissing ? (
        <div className="empty-state">
          <PackageOpen size={48} style={{ opacity: 0.5, margin: '0 auto 1rem', display: 'block' }} />
          <h3>服务器暂无数据源</h3>
          <p>请点击右上角的“上传单据”按钮提交您的 Excel 文件。</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="empty-state">
          <PackageOpen size={48} style={{ opacity: 0.5, margin: '0 auto 1rem', display: 'block' }} />
          <h3>没有找到匹配的订单</h3>
          <p>{orders.length === 0 ? "您可以尝试更换或重新上传数据源。" : "您可以尝试更换其他的搜索关键词。"}</p>
        </div>
      ) : (
        <div className="orders-list">
          {filteredOrders.map((order, i) => {
            const isShipped = isStatusShipped(order.status);
            const isReady = isStatusReady(order.status);
            const isConsolidation = isStatusConsolidation(order.status);

            let cardClass = 'status-unpackaged';
            if (isShipped) cardClass = 'status-packed';
            else if (isReady) cardClass = 'status-packed'; // Reuse ready style base or add new if needed
            return (
              <div 
                key={i}
                className={`order-card ${cardClass}`}
                onClick={() => {
                  setSelectedOrder(order);
                  setIsDrawerOpen(true);
                  setShowBoxSelector(false);
                  // 如果是待合包，自动勾选初始已打包项
                  if (order.packedIndices) {
                    const initialChecks = {};
                    order.packedIndices.forEach(idx => initialChecks[idx] = true);
                    setCheckedItemsMap(prev => ({ ...prev, [order.id]: initialChecks }));
                  }
                }}
              >
                <div className="order-header">
                  <div>
                    <div className="order-id">{order.id || '未知编号'}</div>
                    <div className="order-accounts-list" style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                      {order.accounts && order.accounts.map((acc, aIdx) => (
                        <div 
                          key={aIdx}
                          className="order-account" 
                          title="点击复制账号"
                          onClick={(e) => handleCopyAccount(e, order.id + '-' + aIdx, acc)}
                          style={{ 
                            display: 'inline-flex', 
                            alignItems: 'center', 
                            gap: '6px',
                            cursor: 'pointer',
                            padding: '2px 6px',
                            marginLeft: '-6px',
                            borderRadius: '4px',
                            transition: 'background 0.2s',
                            fontSize: '0.9rem',
                            color: 'var(--text-muted)'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = '#edf2f7'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          {acc}
                          {copiedId === (order.id + '-' + aIdx) ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-green)', fontWeight: 'bold' }}>✓ 已复制</span>
                          ) : (
                            <Copy size={13} color="var(--text-muted)" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <span className={`badge ${isShipped ? 'badge-green' : isReady ? 'badge-green' : isConsolidation ? 'badge-orange' : 'badge-red'}`}>
                    {order.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>包含 {order.items?.length || 0} 项商品</span>
                  {isConsolidation && (
                    <span style={{ color: 'var(--color-warning)', fontWeight: 600, fontSize: '0.8rem' }}>
                      {order.boxCount || 1}个包裹 + {(order.items?.length || 0) - (order.packedIndices?.length || 0)}个散件
                    </span>
                  )}
                  {isReady && (
                    <span style={{ color: 'var(--color-green)', fontWeight: 600, fontSize: '0.8rem' }}>
                      {order.boxCount || 1}个包裹
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 侧边滑出抽屉 */}
      <div className={`modal-overlay ${isDrawerOpen ? 'open' : ''}`} onClick={() => setIsDrawerOpen(false)}>
        <div className="drawer" onClick={(e) => e.stopPropagation()}>
          {selectedOrder && (
            <>
              <button className="drawer-close" onClick={() => setIsDrawerOpen(false)}>
                <X size={24} />
              </button>
              
              <h2>编号: {selectedOrder.id}</h2>
              <div className="subtitle">请对照以下清单仔细核对后装箱</div>
              
              <div className="section-title">商品核对清单 ({selectedOrder.items?.length || 0})</div>
              <ul className="items-list">
                {selectedOrder.items && selectedOrder.items.map((item, idx) => {
                  const isChecked = checkedItemsMap[selectedOrder.id]?.[idx] || false;
                  const isInitiallyPacked = selectedOrder.packedIndices?.includes(idx);
                  
                  let liClass = '';
                  if (isInitiallyPacked || isStatusReady(selectedOrder.status)) liClass = 'item-ready';
                  else if (isStatusConsolidation(selectedOrder.status)) liClass = 'item-pending';
                  else if (isChecked) liClass = 'item-checked';

                  return (
                    <li 
                      key={idx} 
                      className={liClass}
                      onClick={() => !isInitiallyPacked && toggleItemStatus(selectedOrder.id, idx)}
                      style={isInitiallyPacked ? { cursor: 'default' } : {}}
                    >
                      <div className="item-checkbox">
                        {isInitiallyPacked || isStatusReady(selectedOrder.status) ? (
                          <Package size={20} color="var(--color-green)" />
                        ) : isChecked ? (
                          <CheckSquare size={20} color="var(--color-green)" />
                        ) : (
                          <Square size={20} color="var(--text-muted)" />
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span>{item}</span>
                        {isInitiallyPacked && <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>[已在日本包裹中]</span>}
                        {!isInitiallyPacked && isStatusConsolidation(selectedOrder.status) && (
                           <span style={{ fontSize: '0.75rem', color: 'var(--color-warning)' }}>[待上海加入]</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {selectedOrder.pickupCode && (
                <>
                  <div className="section-title">圆通取件码</div>
                  <div style={{ 
                    background: 'var(--color-red-light)', 
                    border: '1px solid var(--color-red)',
                    padding: '1rem', 
                    borderRadius: '8px', 
                    fontSize: '1.2rem', 
                    fontWeight: 700, 
                    color: 'var(--color-red)',
                    marginBottom: '1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <PackageOpen size={20} color="var(--color-red)" />
                    <span>{selectedOrder.pickupCode}</span>
                  </div>
                </>
              )}

              <div className="section-title">收件信息</div>
              <div className="address-box">
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <MapPin size={20} color="var(--text-main)" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <p style={{ margin: 0 }}>{selectedOrder.address || '地址未提供'}</p>
                </div>
              </div>

              <div className="actions" style={{ flexDirection: 'column', gap: '10px' }}>
                {token && (
                  <>
                    <div style={{ display: 'flex', gap: '8px', width: '100%', flexWrap: 'wrap' }}>
                      <button 
                        className={`btn`}
                        style={{ flex: 1, minWidth: '80px', background: '#f7fafc', border: '1px solid #e2e8f0', color: '#718096' }}
                        onClick={() => handleStatusChange(selectedOrder, '未打包')}
                      >标记未打包</button>
                      
                      <button 
                        className={`btn`}
                        style={{ 
                          flex: 1.5,
                          minWidth: '100px',
                          background: isStatusConsolidation(selectedOrder.status) ? 'var(--color-warning)' : '#fffaf0', 
                          color: isStatusConsolidation(selectedOrder.status) ? 'white' : 'var(--color-warning)',
                          border: `1px solid var(--color-warning)` 
                        }}
                        onClick={() => {
                          setSelectorType('consolidation');
                          setShowBoxSelector(!showBoxSelector || selectorType !== 'consolidation');
                        }}
                      >
                        {isStatusConsolidation(selectedOrder.status) ? (showBoxSelector && selectorType === 'consolidation' ? '取消' : `合包(${selectedOrder.boxCount || 1})`) : '待合包'}
                      </button>

                      <button 
                        className={`btn`}
                        style={{ 
                          flex: 1.5,
                          minWidth: '100px',
                          background: isStatusReady(selectedOrder.status) ? 'var(--color-green)' : 'var(--bg-green)', 
                          color: isStatusReady(selectedOrder.status) ? 'white' : 'var(--color-green)',
                          border: `1px solid var(--color-green)` 
                        }}
                        onClick={() => {
                          setSelectorType('ready');
                          setShowBoxSelector(!showBoxSelector || selectorType !== 'ready');
                        }}
                      >
                        {isStatusReady(selectedOrder.status) ? (showBoxSelector && selectorType === 'ready' ? '取消' : `包裹(${selectedOrder.boxCount || 1})`) : '标记已打包'}
                      </button>
                    </div>

                    {showBoxSelector && (
                      <div style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '10px', 
                        padding: '12px', 
                        background: selectorType === 'ready' ? 'var(--bg-green)' : '#fffaf0', 
                        borderRadius: '12px', 
                        border: `1px solid ${selectorType === 'ready' ? 'var(--color-green)' : 'var(--color-warning)'}`,
                        animation: 'fadeIn 0.2s ease-out'
                      }}>
                        <div style={{ fontSize: '0.85rem', color: selectorType === 'ready' ? 'var(--color-green)' : 'var(--color-warning)', fontWeight: 600, textAlign: 'center' }}>
                          请选择【{selectorType === 'ready' ? '已打包' : '待合包'}】的包裹总数：
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                          {[1, 2, 3, 4, 5].map(num => {
                            const themeColor = selectorType === 'ready' ? 'var(--color-green)' : 'var(--color-warning)';
                            return (
                              <button
                                key={num}
                                onClick={() => {
                                  const indices = selectorType === 'consolidation' ? 
                                    Object.entries(checkedItemsMap[selectedOrder.id] || {})
                                      .filter(([_, checked]) => checked)
                                      .map(([idx]) => parseInt(idx)) : null;
                                  handleStatusChange(selectedOrder, selectorType === 'ready' ? '已打包' : '待合包', indices, num);
                                }}
                                style={{
                                  width: '40px',
                                  height: '40px',
                                  borderRadius: '20px',
                                  border: `2px solid ${themeColor}`,
                                  background: selectedOrder.boxCount === num ? themeColor : 'white',
                                  color: selectedOrder.boxCount === num ? 'white' : themeColor,
                                  fontWeight: 'bold',
                                  cursor: 'pointer'
                                }}
                              >
                                {num}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
                
                <button 
                   className={`btn ${isStatusShipped(selectedOrder.status) ? 'btn-primary' : ''}`}
                   style={{ 
                     width: '100%',
                     ...(!isStatusShipped(selectedOrder.status) ? { background: '#f7fafc', border: '1px solid #e2e8f0', color: '#718096' } : {})
                   }}
                   onClick={() => handleStatusChange(selectedOrder, '已发货')}
                >标记已装箱发货</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
