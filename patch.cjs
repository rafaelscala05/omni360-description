const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

const returnRegex = /return \(\s*<div className="min-h-screen bg-gray-50 flex flex-col font-sans">/;
const previewModalRegex = /\{\/\* Preview Modal \*\/\}/;

const startMatch = content.match(returnRegex);
const endMatch = content.match(previewModalRegex);

if (startMatch && endMatch) {
  const startIdx = startMatch.index;
  const endIdx = endMatch.index;

  const newLayout = `
  const renderHistoryView = () => (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto w-full">
      <div className="flex justify-between items-end mb-6">
         <div>
           <h1 className="text-[28px] font-bold text-slate-900 tracking-tight leading-tight">Credit History</h1>
           <p className="text-sm text-slate-500 mt-1">Review your recent transactions and credit usage.</p>
         </div>
         <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-white border border-slate-200 shadow-sm rounded-lg hover:bg-slate-50 text-slate-700 transition-colors">
           <Download className="w-4 h-4" /> Export CSV
         </button>
      </div>
  
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
           <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Available Balance</div>
           <div className="flex items-baseline gap-2 mb-4">
              <span className="text-5xl font-bold text-slate-900 tracking-tight">{credits}</span>
              <span className="text-base text-slate-500">credits</span>
           </div>
           <div className="flex items-center gap-1.5 text-xs text-slate-500">
             <AlertCircle className="w-3.5 h-3.5" /> Renews automatically
           </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center justify-between">
           <div className="flex gap-12">
              <div>
                 <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Used This Month</div>
                 <div className="flex items-baseline gap-2">
                   <span className="text-2xl font-bold text-slate-900">{creditLogs.reduce((acc, log) => acc + log.creditsConsumed, 0)}</span>
                   <span className="text-sm text-slate-500">credits</span>
                 </div>
              </div>
              <div>
                 <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Most Used</div>
                 <div className="text-sm font-medium text-slate-900 mt-1">AI Generation</div>
              </div>
           </div>
           <button className="flex items-center gap-2 px-4 py-2 font-medium text-sm text-white bg-[#004ac6] hover:bg-[#003ea8] transition-colors rounded-lg shadow-sm">
              <Plus className="w-4 h-4" /> Buy Credits
           </button>
        </div>
      </div>
  
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
         <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
            <h2 className="text-base font-bold text-slate-900 tracking-tight">Recent Transactions</h2>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Filter by:</span>
              <select className="text-sm border border-slate-200 rounded-md bg-white pr-8 pl-3 py-1.5 outline-none focus:border-[#004ac6]">
                 <option>All Types</option>
              </select>
            </div>
         </div>
         <table className="w-full text-left text-sm whitespace-nowrap">
           <thead className="bg-[#f7f9fb] border-b border-slate-200">
             <tr>
               <th className="px-6 py-3 font-semibold text-slate-500 text-xs tracking-wider uppercase">Date & Time</th>
               <th className="px-6 py-3 font-semibold text-slate-500 text-xs tracking-wider uppercase">Action</th>
               <th className="px-6 py-3 font-semibold text-slate-500 text-xs tracking-wider uppercase">Product / Details</th>
               <th className="px-6 py-3 text-right font-semibold text-slate-500 text-xs tracking-wider uppercase">Credits</th>
             </tr>
           </thead>
           <tbody className="divide-y divide-slate-100">
             {creditLogs.length === 0 ? (
               <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-500">No transactions recorded.</td></tr>
             ) : (
               creditLogs.map((log) => (
                 <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                   <td className="px-6 py-4 text-slate-600">{new Date(log.timestamp).toLocaleString('pt-BR')}</td>
                   <td className="px-6 py-4">
                     <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 text-slate-600 text-xs font-medium">
                       <RefreshCw className="w-3 h-3" /> {log.actionType}
                     </span>
                   </td>
                   <td className="px-6 py-4 text-slate-900 max-w-xs xl:max-w-md truncate" title={log.productName}>
                     {log.productName}
                     <div className="text-[10px] text-slate-400 font-mono mt-0.5">{log.sku}</div>
                   </td>
                   <td className="px-6 py-4 text-right text-red-500 font-medium">
                     -{log.creditsConsumed}
                   </td>
                 </tr>
               ))
             )}
           </tbody>
         </table>
         <div className="px-6 py-3 border-t border-slate-200 bg-white flex justify-between items-center text-sm text-slate-500">
            <span>Showing transactions</span>
            <div className="flex gap-2">
              <button disabled className="p-1 text-slate-300"><ChevronLeft className="w-4 h-4"/></button>
              <button disabled className="p-1 text-slate-300"><ChevronRight className="w-4 h-4"/></button>
            </div>
         </div>
      </div>
    </div>
  );

  return (
    <div className="h-screen bg-[#f7f9fb] flex font-sans overflow-hidden">
      <input type="file" accept=".xlsx, .xls" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
      {isFirebaseUnavailable && (
        <div className="absolute top-0 inset-x-0 bg-red-600 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2 z-50">
          <AlertCircle className="w-4 h-4" />
          Serviços em nuvem indisponíveis no momento (Verifique cotas ou conexão).
        </div>
      )}
      
      {/* Sidebar */}
      <aside className="w-[260px] bg-[#0f172a] text-white flex-shrink-0 flex flex-col z-20 shadow-[4px_0_24px_rgba(0,0,0,0.05)] pt-4">
        <div className="h-16 px-5 flex items-center gap-3 border-b border-white/5 mx-3 mb-4 pb-4">
          <div className="bg-[#004ac6] p-1.5 rounded-lg shadow-sm">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-white tracking-tight leading-tight">Omni360</span>
            <span className="text-[10px] text-slate-400">Professional</span>
          </div>
        </div>

        <nav className="mt-2 px-3 flex flex-col gap-1 flex-1">
          <button 
            onClick={() => setMainView('products')} 
            className={\`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 \${mainView === 'products' ? 'bg-[#1e293b] text-white font-medium before:absolute before:left-0 before:h-6 before:w-1 before:bg-[#004ac6] before:rounded-r-full relative' : 'text-slate-400 font-medium hover:text-white hover:bg-white/5'}\`}
          >
            <Layout className="w-4 h-4" /> Products
          </button>
          <button 
            onClick={() => setMainView('categories')} 
            className={\`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 \${mainView === 'categories' ? 'bg-[#1e293b] text-white font-medium before:absolute before:left-0 before:h-6 before:w-1 before:bg-[#004ac6] before:rounded-r-full relative' : 'text-slate-400 font-medium hover:text-white hover:bg-white/5'}\`}
          >
            <Folder className="w-4 h-4" /> Categories
          </button>
          <div className="my-2 border-t border-white/5 mx-4"></div>
          <button 
            onClick={() => { setMainView('history'); fetchCreditLogs(); setIsCreditHistoryOpen(false); }} 
            className={\`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 \${mainView === 'history' ? 'bg-[#1e293b] text-white font-medium before:absolute before:left-0 before:h-6 before:w-1 before:bg-[#004ac6] before:rounded-r-full relative' : 'text-slate-400 font-medium hover:text-white hover:bg-white/5'}\`}
          >
            <RefreshCw className="w-4 h-4" /> History
          </button>
        </nav>

        <div className="p-4 mt-auto mb-2 border-t border-white/5 mx-3">
          <button onClick={() => setIsTemplateModalOpen(true)} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 font-medium hover:text-white hover:bg-white/5 transition-colors">
            <Settings className="w-4 h-4" /> Templates
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#f7f9fb] h-screen overflow-hidden">
        {/* Top Bar */}
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between flex-shrink-0 z-10 sticky top-0 shadow-sm">
          <div className="w-[360px] relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Search products..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-full pl-9 pr-4 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6] focus:bg-white transition-all text-slate-700 placeholder-slate-400" 
            />
          </div>

          <div className="flex items-center gap-5">
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-600">
              Credits: <span className="text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-md border border-slate-200 shadow-sm">{credits}</span>
            </div>
            
            <button className="text-slate-400 hover:text-slate-600 transition-colors relative">
               <Bell className="w-4 h-4" />
               <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white"></span>
            </button>
            <button className="text-slate-400 hover:text-slate-600 transition-colors">
               <HelpCircle className="w-4 h-4" />
            </button>
            <div className="h-6 w-px bg-slate-200 mx-1"></div>
            <button onClick={handleLogout} className="flex items-center gap-2 group p-1 pr-2 hover:bg-slate-50 border border-transparent hover:border-slate-200 rounded-full transition-colors" title="Logout">
               <img src={user.photoURL || \`https://ui-avatars.com/api/?name=\${user.email}\`} alt="User Avatar" className="w-7 h-7 rounded-full border border-slate-200 group-hover:border-[#004ac6] transition-colors" />
               <span className="text-xs font-medium text-slate-700 hidden lg:block truncate max-w-[100px]">{user.displayName || user.email?.split('@')[0]}</span>
            </button>
          </div>
        </header>

        {/* Dynamic View Content */}
        <main className="flex-1 overflow-y-auto w-full p-6 bg-[#f7f9fb]">
          {mainView === 'categories' ? (
            <div className="animate-in fade-in h-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <CategoryManager onClose={() => setMainView('products')} />
            </div>
          ) : mainView === 'history' ? (
            renderHistoryView()
          ) : (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col max-w-[1600px] mx-auto">
               <div className="flex justify-between items-center mb-5 flex-shrink-0">
                 <div>
                   <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Product Catalog</h1>
                   <p className="text-sm text-slate-500 mt-0.5">Manage and enrich your product inventory data.</p>
                 </div>
                 
                 <div className="flex items-center gap-2">
                   <button
                     onClick={() => loadFromCloud()}
                     disabled={isLoadingFromCloud}
                     className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg shadow-sm text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                   >
                     <RefreshCw className={\`w-3.5 h-3.5 \${isLoadingFromCloud ? 'animate-spin' : ''}\`} />
                     Sync Cloud
                   </button>
                   <button
                     onClick={() => saveToCloud()}
                     disabled={isSavingToCloud || !hasUnsavedChanges || products.length === 0}
                     className={\`inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-lg shadow-sm text-sm font-medium transition-colors \${
                       hasUnsavedChanges 
                         ? 'bg-blue-50 border-blue-200 text-[#004ac6] hover:bg-blue-100' 
                         : 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100 opacity-50'
                     } disabled:cursor-not-allowed\`}
                   >
                     {isSavingToCloud ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : hasUnsavedChanges ? <Save className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                     {isSavingToCloud ? 'Saving...' : hasUnsavedChanges ? 'Save Changes' : 'Saved'}
                   </button>
                   <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 font-medium text-sm text-white bg-[#004ac6] hover:bg-[#003ea8] transition-colors rounded-lg shadow-sm">
                      <Upload className="w-3.5 h-3.5" /> Import
                   </button>
                 </div>
               </div>

               <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col flex-1 min-h-0 relative">
                 
                 {/* Toolbar */}
                 <div className="px-5 py-3.5 flex flex-wrap items-center justify-between border-b border-slate-200 bg-white gap-3 rounded-t-xl shrink-0">
                     <div className="flex items-center gap-2">
                        <select 
                          className="px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-700 font-medium focus:ring-[#004ac6] outline-none focus:border-[#004ac6] bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                          value={filterMarca}
                          onChange={(e) => setFilterMarca(e.target.value)}
                        >
                          <option value="">All Brands</option>
                          {marcas.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <select 
                          className="px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-700 font-medium focus:ring-[#004ac6] outline-none focus:border-[#004ac6] bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                          value={filterCategoria}
                          onChange={(e) => setFilterCategoria(e.target.value)}
                        >
                          <option value="">All Categories</option>
                          {categorias.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <div className="w-px h-5 bg-slate-200 mx-2"></div>
                        <div className="text-xs text-slate-500 font-medium">{paginatedProducts.length} items</div>
                     </div>
                     <div className="flex items-center gap-2 ml-auto relative">
                        {generationLog && (
                          <div className="mr-3 flex items-center gap-2 text-xs font-medium text-[#004ac6] bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100 shadow-sm animate-in fade-in slide-in-from-right-4">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            {generationProgress.current} / {generationProgress.total} 
                            <span className="opacity-0 sm:opacity-100 overflow-hidden truncate max-w-[150px]">- {generationLog}</span>
                          </div>
                        )}
                        <button
                          onClick={handleEnrichMass}
                          disabled={selectedIds.size === 0 || isEnrichingMass || isGeneratingMass}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-purple-700 border border-purple-200 rounded-lg text-sm font-medium hover:bg-purple-50 hover:border-purple-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                          {isEnrichingMass ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                          <span className="hidden sm:inline">Enrich ({selectedIds.size})</span>
                        </button>
                        <button
                          onClick={handleGenerateMass}
                          disabled={selectedIds.size === 0 || isGeneratingMass || isEnrichingMass}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-[#004ac6] border border-blue-200 rounded-lg text-sm font-medium hover:bg-blue-50 hover:border-[#004ac6] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                          {isGeneratingMass ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          <span className="hidden sm:inline">Generate ({selectedIds.size})</span>
                        </button>
                        
                        <div className="w-px h-5 bg-slate-200 mx-2"></div>
                        
                        <button
                          onClick={() => setIsColumnConfigOpen(!isColumnConfigOpen)}
                          className="p-1.5 border border-slate-200 bg-white rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
                          title="Visible Columns"
                        >
                          <Filter className="w-4 h-4" />
                        </button>
                        
                        <button
                          onClick={handleExport}
                          className="p-1.5 border border-slate-200 bg-white rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
                          title="Export View"
                        >
                          <Download className="w-4 h-4" />
                        </button>

                        {isColumnConfigOpen && (
                            <div className="absolute right-0 top-12 w-56 bg-white border border-slate-200 rounded-xl shadow-xl p-3 z-30 animate-in fade-in slide-in-from-top-2 origin-top-right">
                              <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-100">
                                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Columns</h4>
                                <button onClick={() => setIsColumnConfigOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5"/></button>
                              </div>
                              <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                                {Object.keys(visibleColumns).map(col => (
                                  <label key={col} className="flex items-center gap-2 cursor-pointer py-1.5 px-2 hover:bg-slate-50 rounded-md transition-colors group">
                                    <input type="checkbox" checked={visibleColumns[col]} onChange={(e) => setVisibleColumns(prev => ({ ...prev, [col]: e.target.checked }))} className="rounded border-slate-300 text-[#004ac6] focus:ring-[#004ac6] opacity-70 group-hover:opacity-100 transition-opacity" />
                                    <span className="text-sm text-slate-700 group-hover:text-slate-900 font-medium">{col}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                        )}
                     </div>
                 </div>

                 {/* Products Table Core */}
                 <div className="flex-1 overflow-auto relative rounded-b-xl">
                     <table className="min-w-full text-left text-sm whitespace-nowrap">
                       <thead className="bg-[#f7f9fb] border-b border-slate-200 sticky top-0 z-20 shadow-sm backdrop-blur-sm bg-opacity-95">
                         <tr>
                            <th className="px-5 py-3.5 w-12 border-r border-slate-200">
                              <input
                                type="checkbox"
                                onChange={(e) => setSelectedIds(e.target.checked ? new Set(paginatedProducts.map(p => p._id)) : new Set())}
                                className="rounded border-slate-300 text-[#004ac6] focus:ring-[#004ac6]"
                              />
                            </th>
                            {visibleColumns['Img'] && <th className="px-4 py-3.5 font-bold text-slate-600 text-xs tracking-wider uppercase">IMG</th>}
                            {visibleColumns['SKU'] && <th className="px-4 py-3.5 font-bold text-slate-600 text-xs tracking-wider uppercase">SKU</th>}
                            {visibleColumns['Descrição'] && <th className="px-4 py-3.5 font-bold text-slate-600 text-xs tracking-wider uppercase">Description</th>}
                            {visibleColumns['Categoria'] && <th className="px-4 py-3.5 font-bold text-slate-600 text-xs tracking-wider uppercase">Category</th>}
                            {visibleColumns['Marca'] && <th className="px-4 py-3.5 font-bold text-slate-600 text-xs tracking-wider uppercase">Brand</th>}
                            {visibleColumns['Status Desc.'] && <th className="px-4 py-3.5 font-bold text-slate-600 text-xs tracking-wider uppercase">Status</th>}
                            <th className="px-5 py-3.5 text-right font-bold text-slate-600 text-xs tracking-wider uppercase bg-[#f7f9fb] shadow-[inset_1px_0_0_0_#e2e8f0] sticky right-0 z-20">Actions</th>
                         </tr>
                       </thead>
                       <tbody className="divide-y divide-slate-100">
                          {products.length === 0 ? (
                            <tr>
                              <td colSpan={20}>
                                <div className="p-16 flex flex-col items-center justify-center text-center">
                                  <div className="w-16 h-16 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center mb-4">
                                     <FileSpreadsheet className="w-8 h-8 text-slate-400" />
                                  </div>
                                  <h3 className="text-lg font-bold text-slate-900 mb-1">No products imported yet</h3>
                                  <p className="text-sm text-slate-500 mb-6 max-w-sm">Upload an Excel spreadsheet with your product data to begin.</p>
                                  <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-[#004ac6] text-white rounded-lg shadow-sm font-medium hover:bg-[#003ea8] transition-colors text-sm">
                                    Import File
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ) : paginatedProducts.length === 0 ? (
                            <tr><td colSpan={20} className="text-center p-8 text-slate-500">No products match your filters.</td></tr>
                          ) : paginatedProducts.map(product => {
                            const isProcessed = product._statusDescricao === 'Gerado por IA';
                            const isOriginal = product._statusDescricao === 'Descrição original';

                            return (
                            <tr key={product._id} className={\`hover:bg-[#f1f5f9]/60 transition-colors group relative \${selectedIds.has(product._id) ? 'bg-blue-50/40' : 'bg-white'}\`}>
                              <td className="px-5 py-3 border-r border-slate-100 bg-inherit">
                                <div className={\`absolute left-0 top-0 bottom-0 w-1 transition-colors \${isProcessed ? 'bg-indigo-500' : isOriginal ? 'bg-emerald-500' : 'bg-transparent'}\`}></div>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(product._id)}
                                  onChange={(e) => {
                                    const next = new Set(selectedIds);
                                    if (e.target.checked) next.add(product._id);
                                    else next.delete(product._id);
                                    setSelectedIds(next);
                                  }}
                                  className="rounded border-slate-300 text-[#004ac6] focus:ring-[#004ac6]"
                                />
                              </td>
                              {visibleColumns['Img'] && (
                                <td className="px-4 py-2.5 bg-inherit">
                                   {product._selectedImage ? (
                                     <div className="w-10 h-10 rounded-md border border-slate-200 overflow-hidden bg-white p-[1px] shadow-sm hover:border-[#004ac6] cursor-pointer transition-colors" onClick={() => setCurrentImageSearchProduct(product)}>
                                       <img src={product._selectedImage} alt="Product" className="w-full h-full object-contain rounded-sm" />
                                     </div>
                                   ) : product['URL imagem 1'] ? (
                                     <div className="w-10 h-10 rounded-md border border-slate-200 overflow-hidden bg-white p-[1px] shadow-sm hover:border-[#004ac6] cursor-pointer transition-colors" onClick={() => setCurrentImageSearchProduct(product)}>
                                       <img src={product['URL imagem 1'].toString()} alt="Product" className="w-full h-full object-contain rounded-sm" />
                                     </div>
                                   ) : (
                                     <div className="w-10 h-10 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 hover:border-[#004ac6] hover:text-[#004ac6] cursor-pointer transition-colors shadow-sm" onClick={() => setCurrentImageSearchProduct(product)}>
                                       <ImageIcon className="w-4 h-4 opacity-70" />
                                     </div>
                                   )}
                                </td>
                              )}
                              {visibleColumns['SKU'] && <td className="px-4 py-3 font-mono text-xs text-slate-600 font-medium bg-inherit">{product['Código (SKU)']}</td>}
                              {visibleColumns['Descrição'] && (
                                <td className="px-4 py-3 text-slate-900 bg-inherit">
                                  <div className="max-w-[400px] 2xl:max-w-[600px] truncate" title={product['Descrição']}>{product['Descrição']}</div>
                                </td>
                              )}
                              {visibleColumns['Categoria'] && <td className="px-4 py-3 text-slate-500 text-xs bg-inherit"><div className="max-w-[120px] truncate">{product['Categoria'] || '-'}</div></td>}
                              {visibleColumns['Marca'] && <td className="px-4 py-3 text-slate-500 text-xs bg-inherit"><div className="max-w-[100px] truncate">{product['Marca'] || '-'}</div></td>}
                              {visibleColumns['Status Desc.'] && (
                                <td className="px-4 py-3 bg-inherit">
                                   <span className={\`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest \${isProcessed ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/50' : isOriginal ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50' : 'bg-red-50 text-red-700 border border-red-200/50'}\`}>
                                     {isProcessed ? 'Optimized' : isOriginal ? 'Active' : 'Draft'}
                                   </span>
                                </td>
                              )}
                              <td className="px-5 py-3 text-right bg-inherit transition-colors sticky right-0 shadow-[inset_1px_0_0_0_#f1f5f9] group-hover:shadow-[inset_1px_0_0_0_#e2e8f0] z-10 w-[140px]">
                                <div className="flex items-center justify-end gap-1.5 bg-inherit h-full">
                                  <button onClick={() => openPreview(product)} className="text-slate-400 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 p-1.5 rounded-md transition-all shadow-sm flex items-center justify-center w-8 h-8" title="Edit Data">
                                    <Edit className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => handleEnrichSingle(product._id)} disabled={product._isEnriching} className="text-slate-400 hover:text-purple-700 bg-white border border-slate-200 hover:border-purple-300 hover:bg-purple-50 p-1.5 rounded-md transition-all shadow-sm disabled:opacity-50 flex items-center justify-center w-8 h-8" title="Enrich Data">
                                    <Search className={\`w-3.5 h-3.5 \${product._isEnriching ? 'animate-spin text-purple-600' : ''}\`} />
                                  </button>
                                  <button onClick={() => handleGenerateSingle(product._id)} disabled={product._isGenerating} className="text-slate-400 hover:text-[#004ac6] bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 p-1.5 rounded-md transition-all shadow-sm disabled:opacity-50 flex items-center justify-center w-8 h-8" title="Generate Overview">
                                    <Sparkles className={\`w-3.5 h-3.5 \${product._isGenerating ? 'animate-pulse text-[#004ac6]' : ''}\`} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )})}
                       </tbody>
                     </table>
                 </div>

                 {/* Pagination Footer */}
                 {products.length > 0 && (
                   <div className="px-5 py-3 border-t border-slate-200 bg-white flex justify-between items-center text-xs text-slate-500 rounded-b-xl shrink-0">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span>Rows per page:</span>
                          <select
                            value={itemsPerPage}
                            onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                            className="text-xs border-slate-200 rounded-md font-medium focus:ring-[#004ac6] focus:border-[#004ac6] py-1 px-2.5 hover:bg-slate-50 transition-colors cursor-pointer outline-none shadow-sm"
                          >
                            <option value={10}>10</option>
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                          </select>
                        </div>
                        <span className="hidden sm:inline">Showing <span className="font-medium text-slate-700">{Math.min(filteredProducts.length, (currentPage - 1) * itemsPerPage + 1)}</span> to <span className="font-medium text-slate-700">{Math.min(filteredProducts.length, currentPage * itemsPerPage)}</span> of <span className="font-medium text-slate-700">{filteredProducts.length}</span> results</span>
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-3 py-1.5 bg-white border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm font-medium">Prev</button>
                        <div className="flex items-center gap-1 px-2">
                           <span className="font-medium text-slate-900">{currentPage}</span> <span className="text-slate-400">/</span> <span>{totalPages || 1}</span>
                        </div>
                        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0} className="px-3 py-1.5 bg-white border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm font-medium">Next</button>
                      </div>
                   </div>
                 )}
               </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
  `;
  
  const finalContent = content.substring(0, startIdx) + newLayout + '\n      ' + content.substring(endIdx);
  fs.writeFileSync('src/App.tsx', finalContent, 'utf8');
  console.log("Patched successfully!");
} else {
  console.log("Regex boundaries not found!");
}
