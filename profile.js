function formatXpLabel(xp) {
    return (xp / 1000).toFixed(1) + ' kB';
}

function createSvgElement(type, attributes, parent) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', type);
    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'textContent') {
            element.textContent = value;
        } else {
            element.setAttribute(key, value);
        }
    }
    if (parent) {
        parent.appendChild(element);
    }
    return element;
}

function showError(containerId, message) {
    const container = document.getElementById(containerId);
    container.innerHTML = `
        <div class="error-message" style="text-align:center; padding:20px;">
            <p>${message}</p>
            <button onclick="location.reload()">Retry</button>
        </div>
    `;
}

function setupSvgGraph(svgId, title, data, emptyMessage = 'No data available') {
    const svg = document.getElementById(svgId);
    const width = svg.width.baseVal.value;
    const height = svg.height.baseVal.value;
    
    svg.innerHTML = '';
    
    if (!data || (Array.isArray(data) && data.length === 0)) {
        createSvgElement('text', {
            x: width / 2,
            y: height / 2,
            'text-anchor': 'middle',
            'font-size': '16px',
            textContent: emptyMessage
        }, svg);
        return null;
    }
    
    createSvgElement('text', {
        x: width / 2,
        y: 30,
        'text-anchor': 'middle',
        'font-size': '16px',
        'font-weight': 'bold',
        textContent: title
    }, svg);
    
    return {
        svg,
        width,
        height
    };
}

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('jwtToken');
    if (!token) {
        window.location.href = 'index.html';
        return;
    }
    
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('jwtToken');
        localStorage.removeItem('userId');
        window.location.href = 'index.html';
    });
    
    async function fetchGraphQL(query, retries = 3, delay = 1000) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const response = await fetch('https://learn.reboot01.com/api/graphql-engine/v1/graphql', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ query })
                });
                
                if (!response.ok) {
                    throw new Error(`GraphQL query failed: ${response.status}`);
                }
                
                return await response.json();
            } catch (error) {
                console.warn(`Attempt ${attempt+1}/${retries+1} failed:`, error.message);
                if (attempt === retries) throw error;
                
                await new Promise(r => setTimeout(r, delay * (attempt + 1)));
            }
        }
    }

    async function fetchWithCache(queryName, query, userId, maxAge = 30 * 60 * 1000) {
        const cacheKey = `graphql_${queryName}_${userId}`;
        const cached = localStorage.getItem(cacheKey);
        
        if (cached) {
            try {
                const { data, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < maxAge) {
                    console.log(`Using cached data for ${queryName}`);
                    return { data };
                }
            } catch (e) {
                console.warn("Cache parse error:", e);
            }
        }
        
        const result = await fetchGraphQL(query);
        if (result?.data) {
            localStorage.setItem(cacheKey, JSON.stringify({
                data: result.data,
                timestamp: Date.now()
            }));
        }
        return result;
    }
    
    try {
        let user = JSON.parse(localStorage.getItem('user'));
        const userId = user?.id || localStorage.getItem('userId');

        if (!user && userId) {
            try {
                const userQuery = `{
                    user {
                        id
                        login
                        firstName
                        lastName
                    }
                }`;
                
                const userData = await fetchGraphQL(userQuery);
                if (userData?.data?.user?.[0]) {
                    user = userData.data.user[0];
                    localStorage.setItem('user', JSON.stringify(user));
                }
            } catch (error) {
                console.warn("Couldn't fetch user details:", error);
            }
        }
        
        if (!userId) {
            window.location.href = 'index.html';
            return;
        }

        if (user) {
            document.getElementById('user-info').innerHTML = `
                <div class="info-card">
                    <p><strong>User ID:</strong> ${user.id}</p>
                    <p><strong>Login:</strong> ${user.login}</p>
                    <p><strong>Name:</strong> ${user.firstName || ''} ${user.lastName || ''}</p>
                </div>
            `;
        } else {
            document.getElementById('user-info').innerHTML = `
                <div class="info-card">
                    <p><strong>User ID:</strong> ${userId}</p>
                    <p>Additional user details not available</p>
                </div>
            `;
        }
        
        const xpQuery = `{
            transaction(
                where: {
                    type: {_eq: "xp"}, 
                    userId: {_eq: ${userId}}
                },
                order_by: {createdAt: asc}
            ) {
                id
                amount
                createdAt
                path
                objectId
            }
        }`;
        
        const xpData = await fetchWithCache('xp', xpQuery, userId);
        if (!xpData || !xpData.data) throw new Error('Failed to fetch XP data');
        
        const transactions = xpData.data.transaction;
        
        const totalXP = transactions.reduce((sum, t) => sum + t.amount, 0);
        
        const xpByProject = transactions.reduce((acc, t) => {
            const pathParts = t.path.split('/');
            const projectName = pathParts[pathParts.length - 1];
            
            if (!acc[projectName]) {
                acc[projectName] = 0;
            }
            acc[projectName] += t.amount;
            return acc;
        }, {});
        
        let xpByProjectHTML = '';
        Object.entries(xpByProject)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .forEach(([project, amount]) => {
                xpByProjectHTML += `<p><strong>${project}:</strong> ${formatXpLabel(amount)}</p>`;
            });
        
        document.getElementById('xp-info').innerHTML = `
            <div class="info-card">
                <p><strong>Total XP:</strong> ${formatXpLabel(totalXP)}</p>
                <h4>Top Projects by XP:</h4>
                ${xpByProjectHTML}
            </div>
        `;
        
        const progressQuery = `{
            progress(
                where: {
                    userId: {_eq: ${userId}}
                },
                order_by: {updatedAt: desc}
            ) {
                id
                grade
                createdAt
                updatedAt
                path
                object {
                    id
                    name
                    type
                }
            }
        }`;
        const progressData = await fetchWithCache('progress', progressQuery, userId);
        if (!progressData?.data) throw new Error('Failed to fetch progress data');

        const progress = progressData.data.progress;

        const latestByObj = progress.reduce((acc, p) => {
            const key = p.object.id;
            if (!acc[key] || new Date(p.updatedAt) > new Date(acc[key].updatedAt)) {
                acc[key] = p;
            }
            return acc;
        }, {});

        const uniqueProgress = Object.values(latestByObj);
        const inProgress = uniqueProgress.filter(p => p.grade === null).length;
        const passedProjects = uniqueProgress.filter(p => p.grade > 0).length;
        const failedProjects = uniqueProgress.filter(p => p.grade === 0).length;

        const totalDone    = passedProjects + failedProjects;
        const passRate     = totalDone ? Math.round(passedProjects/totalDone*100) : 0;

        function setElementContent(id, content) {
            const element = document.getElementById(id);
            if (element) element.textContent = content;
        }

        setElementContent('passed-count', passedProjects);
        setElementContent('failed-count', failedProjects);
        setElementContent('pass-rate', passRate + '%');

        const recentContainer = document.getElementById('recent-projects');
        recentContainer.innerHTML = '';  // clear loader
        uniqueProgress
          .sort((a,b)=> new Date(b.updatedAt) - new Date(a.updatedAt))
          .slice(0,5)
          .forEach(p => {
            const div = document.createElement('div');
            div.className = 'project-item';
            
            const status = p.grade === null ? 'In Progress' : 
                          p.grade > 0 ? 'Passed' : 'Failed';
            const cls = p.grade === null ? 'status-progress' : 
                       p.grade > 0 ? 'status-passed' : 'status-failed';
            
            div.innerHTML = `
              <span>${p.path.split('/').pop()}</span>
              <span class="${cls}">${status}</span>`;
            recentContainer.appendChild(div);
          });

        setTimeout(() => {
            try {
                createXpProgressGraph(transactions);
                createProjectRatioGraph(passedProjects, failedProjects);
            } catch (err) {
                console.error("Chart rendering error:", err);
                document.getElementById('xp-time-graph').innerHTML = 
                    '<text x="50%" y="50%" text-anchor="middle">Charts unavailable. Please reload.</text>';
                document.getElementById('project-ratio-graph').innerHTML = 
                    '<text x="50%" y="50%" text-anchor="middle">Charts unavailable. Please reload.</text>';
            }
        }, 100);

        document.getElementById('refresh-btn')?.addEventListener('click', () => {
            localStorage.removeItem(`graphql_xp_${userId}`);
            location.reload();
        });
        
    } catch (error) {
        console.error('Error:', error);
        showError('user-info', 'Network error. Unable to load profile data.');
        showError('xp-info', 'Network error. Unable to load XP data.');  
        showError('projects-info', 'Network error. Unable to load project data.');
        showError('statistics-section', 'Network error. Unable to load statistics.');
    }
});

function createXpProgressGraph(transactions) {
    const setup = setupSvgGraph(
        'xp-time-graph',
        '',
        transactions?.length > 0 ? transactions : null,
        'No XP data available'
    );
    
    if (!setup) return;
    const { svg, width, height } = setup;
    
    let cumulativeXP = 0;
    const dataPoints = transactions.map(t => {
        cumulativeXP += t.amount;
        return {
            date: new Date(t.createdAt),
            xp: cumulativeXP
        };
    });
    
    const padding = { left: 80, right: 40, top: 40, bottom: 60 };
    
    const minDate = dataPoints[0].date;
    const maxDate = dataPoints[dataPoints.length - 1].date;
    const maxXP = dataPoints[dataPoints.length - 1].xp;
    
    const xScale = (date) => {
        const range = maxDate - minDate;
        return padding.left + ((date - minDate) / range) * (width - padding.left - padding.right);
    };
    
    const yScale = (xp) => {
        return height - padding.bottom - (xp / maxXP) * (height - padding.top - padding.bottom);
    };
    
    createSvgElement('line', {
        x1: padding.left,
        y1: height - padding.bottom,
        x2: width - padding.right,
        y2: height - padding.bottom,
        stroke: '#333',
        'stroke-width': '2'
    }, svg);
    
    createSvgElement('line', {
        x1: padding.left,
        y1: padding.top,
        x2: padding.left,
        y2: height - padding.bottom,
        stroke: '#333',
        'stroke-width': '2'
    }, svg);
    
    createSvgElement('text', {
        x: width / 2,
        y: height - 15,
        'text-anchor': 'middle',
        textContent: 'Time'
    }, svg);
    
    createSvgElement('text', {
        x: 20,
        y: height / 2,
        transform: `rotate(-90, 20, ${height/2})`,
        'text-anchor': 'middle',
        'font-size': '12px',
        textContent: 'Total XP'
    }, svg);
    
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dateRange = maxDate - minDate;
    const dayRange = dateRange / (1000 * 60 * 60 * 24);

    let currentDate = new Date(minDate);
    currentDate.setDate(1); // Move to first of month

    const monthOffset = currentDate.getMonth() % 3;
    if (monthOffset !== 0) {
        currentDate.setMonth(currentDate.getMonth() + (3 - monthOffset));
    }

    while (currentDate <= maxDate) {
        const x = xScale(currentDate);
        
        createSvgElement('line', {
            x1: x,
            y1: height - padding.bottom,
            x2: x,
            y2: height - padding.bottom + 5,
            stroke: '#333'
        }, svg);
        
        createSvgElement('text', {
            x: x,
            y: height - padding.bottom + 20,
            'text-anchor': 'middle',
            'font-size': '12px',
            textContent: `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`
        }, svg);
        
        createSvgElement('line', {
            x1: x,
            y1: padding.top,
            x2: x,
            y2: height - padding.bottom,
            stroke: '#eee',
            'stroke-width': '1'
        }, svg);
        
        currentDate.setMonth(currentDate.getMonth() + 3);
    }

    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
        const xpValue = (maxXP / yTicks) * i;
        const y = yScale(xpValue);
        
        createSvgElement('line', {
            x1: padding.left,
            y1: y,
            x2: padding.left - 5,
            y2: y,
            stroke: '#333'
        }, svg);
        
        createSvgElement('text', {
            x: padding.left - 10,
            y: y + 4,
            'text-anchor': 'end',
            'font-size': '12px',
            textContent: formatXpLabel(xpValue)
        }, svg);
        
        createSvgElement('line', {
            x1: padding.left,
            y1: y,
            x2: width - padding.right,
            y2: y,
            stroke: '#eee',
            'stroke-width': '1'
        }, svg);
    }
    
    let pathData = '';
    dataPoints.forEach((point, i) => {
        const x = xScale(point.date);
        const y = yScale(point.xp);
        pathData += (i === 0) ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });
    
    createSvgElement('path', {
        d: `${pathData} L ${xScale(maxDate)} ${height - padding.bottom} L ${xScale(minDate)} ${height - padding.bottom} Z`,
        fill: 'rgba(52, 152, 219, 0.2)'
    }, svg);
    
    createSvgElement('path', {
        d: pathData,
        fill: 'none',
        stroke: '#3498db',
        'stroke-width': '3'
    }, svg);
}

function createProjectRatioGraph(passed, failed) {
    const total = passed + failed;
    
    const setup = setupSvgGraph(
        'project-ratio-graph',
        '',
        total > 0 ? { passed, failed } : null,
        'No project data available'
    );
    
    if (!setup) return;
    
    const { svg, width, height } = setup;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 40;
    
    const passedPercent = passed / total;
    const failedPercent = failed / total;
    const passedAngle = passedPercent * 360;
    
    const passedColor = '#2ecc71';
    const failedColor = '#e74c3c';
    
    const donutWidth = radius * 0.4;
    
    createSvgElement('circle', {
        cx: centerX,
        cy: centerY,
        r: radius - donutWidth,
        fill: '#f5f5f5'
    }, svg);
    
    function getArcPath(startAngle, endAngle, isLargeArc) {
        const startRad = (startAngle - 90) * Math.PI / 180;
        const endRad = (endAngle - 90) * Math.PI / 180;
        
        const x1 = centerX + radius * Math.cos(startRad);
        const y1 = centerY + radius * Math.sin(startRad);
        const x2 = centerX + radius * Math.cos(endRad);
        const y2 = centerY + radius * Math.sin(endRad);
        
        const x3 = centerX + (radius - donutWidth) * Math.cos(endRad);
        const y3 = centerY + (radius - donutWidth) * Math.sin(endRad);
        const x4 = centerX + (radius - donutWidth) * Math.cos(startRad);
        const y4 = centerY + (radius - donutWidth) * Math.sin(startRad);
        
        return `M ${x1} ${y1} A ${radius} ${radius} 0 ${isLargeArc} 1 ${x2} ${y2} 
                L ${x3} ${y3} A ${radius - donutWidth} ${radius - donutWidth} 0 ${isLargeArc} 0 ${x4} ${y4} Z`;
    }
    
    if (passed > 0) {
        createSvgElement('path', {
            d: getArcPath(0, passedAngle, passedAngle > 180 ? 1 : 0),
            fill: passedColor
        }, svg);
    }
    
    if (failed > 0) {
        createSvgElement('path', {
            d: getArcPath(passedAngle, 360, (360 - passedAngle) > 180 ? 1 : 0),
            fill: failedColor
        }, svg);
    }
    
    function calculateLabelPosition(centerX, centerY, radius, angleDegrees) {
        const angleRad = (angleDegrees - 90) * Math.PI / 180;
        return {
            x: centerX + radius * Math.cos(angleRad),
            y: centerY + radius * Math.sin(angleRad)
        };
    }

    const passedLabelPos = calculateLabelPosition(
        centerX, centerY, radius - donutWidth / 2, passedAngle / 2
    );

    const failedLabelAngle = (passedAngle + (360 - passedAngle) / 2) - 90;
    const failedLabelRad = failedLabelAngle * Math.PI / 180;
    const failedLabelX = centerX + (radius - donutWidth / 2) * Math.cos(failedLabelRad);
    const failedLabelY = centerY + (radius - donutWidth / 2) * Math.sin(failedLabelRad);
    
    if (passedPercent > 0.05) {
        createSvgElement('text', {
            x: passedLabelPos.x,
            y: passedLabelPos.y,
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            'font-size': '14px',
            'font-weight': 'bold',
            'fill': 'black',
            textContent: `${Math.round(passedPercent * 100)}% pass`  // Added "pass"
        }, svg);
    }
    
    if (failedPercent >= 0.20) {
        createSvgElement('text', {
            x: failedLabelX,
            y: failedLabelY,
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            'font-size': '14px',
            'font-weight': 'bold',
            'fill': 'black',
            textContent: `${Math.round(failedPercent * 100)}% fail`
        }, svg);
    }
    else if (failedPercent > 0) {
        const outsideLabelAngle = failedLabelAngle;
        const outsideLabelRad = outsideLabelAngle * Math.PI / 180;
        const outsideLabelX = centerX + (radius + 25) * Math.cos(outsideLabelRad);
        const outsideLabelY = centerY + (radius + 25) * Math.sin(outsideLabelRad);
        
        createSvgElement('line', {
            x1: centerX + radius * Math.cos(outsideLabelRad) * 0.8,
            y1: centerY + radius * Math.sin(outsideLabelRad) * 0.8,
            x2: outsideLabelX - 5 * Math.cos(outsideLabelRad),
            y2: outsideLabelY - 5 * Math.sin(outsideLabelRad),
            stroke: '#777',
            'stroke-width': '1'
        }, svg);
        
        createSvgElement('text', {
            x: outsideLabelX,
            y: outsideLabelY,
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            'font-size': '14px',
            'font-weight': 'bold',
            textContent: `${Math.round(failedPercent * 100)}% fail`
        }, svg);
    }
}