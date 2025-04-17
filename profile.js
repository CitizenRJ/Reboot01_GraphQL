// Helper function to format XP values in kB
function formatXpLabel(xp) {
    return (xp / 1000).toFixed(1) + ' kB';
}

// Helper function to create SVG elements
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

// Add this function at the top
function showError(containerId, message) {
    const container = document.getElementById(containerId);
    container.innerHTML = `
        <div class="error-message" style="text-align:center; padding:20px;">
            <p>${message}</p>
            <button onclick="location.reload()">Retry</button>
        </div>
    `;
}

// Helper function for SVG graph initialization
function setupSvgGraph(svgId, title, data, emptyMessage = 'No data available') {
    const svg = document.getElementById(svgId);
    const width = svg.width.baseVal.value;
    const height = svg.height.baseVal.value;
    
    // Clear existing content
    svg.innerHTML = '';
    
    // Check if there's data to display
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
    
    // Add title
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
    // Authentication check
    const token = localStorage.getItem('jwtToken');
    if (!token) {
        window.location.href = 'index.html';
        return;
    }
    
    // Logout function
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('jwtToken');
        localStorage.removeItem('userId');
        window.location.href = 'index.html';
    });
    
    // GraphQL query function
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
                
                // Wait before retrying (increasing delay with each retry)
                await new Promise(r => setTimeout(r, delay * (attempt + 1)));
            }
        }
    }

    async function fetchWithCache(queryName, query, userId, maxAge = 30 * 60 * 1000) {
        // Use passed userId instead of global user.id
        const cacheKey = `graphql_${queryName}_${userId}`;
        const cached = localStorage.getItem(cacheKey);
        
        if (cached) {
            try {
                const { data, timestamp } = JSON.parse(cached);
                // If cache is fresh, use it
                if (Date.now() - timestamp < maxAge) {
                    console.log(`Using cached data for ${queryName}`);
                    return { data };
                }
            } catch (e) {
                console.warn("Cache parse error:", e);
            }
        }
        
        // Otherwise fetch fresh data
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
        // 1. BASIC QUERY - Get user info
        const userQuery = `{
            user {
                id
                login
                firstName
                lastName
                attrs
            }
        }`;
        
        const userData = await fetchWithCache('user', userQuery, user.id);
        if (!userData || !userData.data) throw new Error('Failed to fetch user data');
        
        const user = userData.data.user[0];
        
        // Display user info
        document.getElementById('user-info').innerHTML = `
            <div class="info-card">
                <p><strong>User ID:</strong> ${user.id}</p>
                <p><strong>Login:</strong> ${user.login}</p>
                <p><strong>Name:</strong> ${user.firstName || ''} ${user.lastName || ''}</p>
            </div>
        `;
        
        // 2. QUERY WITH ARGUMENTS - Get XP data for this user
        const xpQuery = `{
            transaction(
                where: {
                    type: {_eq: "xp"}, 
                    userId: {_eq: ${user.id}}
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
        
        // Before fetching data, make sure you have user ID
        const userId = user?.id || localStorage.getItem('userId');

        // Then pass it to your fetch calls
        const xpData = await fetchWithCache('xp', xpQuery, userId);
        if (!xpData || !xpData.data) throw new Error('Failed to fetch XP data');
        
        const transactions = xpData.data.transaction;
        
        // Calculate total XP
        const totalXP = transactions.reduce((sum, t) => sum + t.amount, 0);
        
        // Group XP by project path
        const xpByProject = transactions.reduce((acc, t) => {
            // Extract project name from path
            const pathParts = t.path.split('/');
            const projectName = pathParts[pathParts.length - 1];
            
            if (!acc[projectName]) {
                acc[projectName] = 0;
            }
            acc[projectName] += t.amount;
            return acc;
        }, {});
        
        // Display XP info
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
        
        // 3. NESTED QUERY – only fetch non‐null grades (i.e. completed attempts)
        const progressQuery = `{
            progress(
                where: {
                    userId: {_eq: ${user.id}}
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

        // Dedupe to latest per object
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

        // Update DOM with pass/fail stats
        document.getElementById('passed-count').textContent = passedProjects;
        document.getElementById('failed-count').textContent = failedProjects;
        document.getElementById('pass-rate').textContent   = passRate + '%';

        // Populate recent projects list
        const recentContainer = document.getElementById('recent-projects');
        recentContainer.innerHTML = '';  // clear loader
        uniqueProgress
          .sort((a,b)=> new Date(b.updatedAt) - new Date(a.updatedAt))
          .slice(0,5)
          .forEach(p => {
            const div = document.createElement('div');
            div.className = 'project-item';
            
            // Handle null grades as "In Progress"
            const status = p.grade === null ? 'In Progress' : 
                          p.grade > 0 ? 'Passed' : 'Failed';
            const cls = p.grade === null ? 'status-progress' : 
                       p.grade > 0 ? 'status-passed' : 'status-failed';
            
            div.innerHTML = `
              <span>${p.path.split('/').pop()}</span>
              <span class="${cls}">${status}</span>`;
            recentContainer.appendChild(div);
          });

        // Lazy load charts AFTER the critical content is displayed
        setTimeout(() => {
            try {
                createXpProgressGraph(transactions);
                createProjectRatioGraph(passedProjects, failedProjects);
            } catch (err) {
                console.error("Chart rendering error:", err);
                // Display fallback message in chart containers
                document.getElementById('xp-time-graph').innerHTML = 
                    '<text x="50%" y="50%" text-anchor="middle">Charts unavailable. Please reload.</text>';
                document.getElementById('project-ratio-graph').innerHTML = 
                    '<text x="50%" y="50%" text-anchor="middle">Charts unavailable. Please reload.</text>';
            }
        }, 100); // Small delay after main content loads
        
    } catch (error) {
        console.error('Error:', error);
        showError('user-info', 'Network error. Unable to load profile data.');
        showError('xp-info', 'Network error. Unable to load XP data.');  
        showError('projects-info', 'Network error. Unable to load project data.');
        showError('statistics-section', 'Network error. Unable to load statistics.');
    }
});

// SVG Graph 1: XP Progression Over Time
function createXpProgressGraph(transactions) {
    // Initialize SVG without title (since it's already in HTML)
    const svg = document.getElementById('xp-time-graph');
    const width = svg.width.baseVal.value;
    const height = svg.height.baseVal.value;
    
    // Clear existing content
    svg.innerHTML = '';
    
    // Check if there's data to display
    if (!transactions || transactions.length === 0) {
        createSvgElement('text', {
            x: width / 2,
            y: height / 2,
            'text-anchor': 'middle',
            'font-size': '16px',
            textContent: 'No XP data available'
        }, svg);
        return;
    }
    
    // Calculate dataPoints (no title added)
    let cumulativeXP = 0;
    const dataPoints = transactions.map(t => {
        cumulativeXP += t.amount;
        return {
            date: new Date(t.createdAt),
            xp: cumulativeXP
        };
    });
    
    // Increase left padding specifically to make room for the y-axis label
    const padding = { left: 80, right: 40, top: 40, bottom: 60 };
    
    // Sort transactions and calculate cumulative XP
    const minDate = dataPoints[0].date;
    const maxDate = dataPoints[dataPoints.length - 1].date;
    const maxXP = dataPoints[dataPoints.length - 1].xp;
    
    // Update scale functions for new padding
    const xScale = (date) => {
        const range = maxDate - minDate;
        return padding.left + ((date - minDate) / range) * (width - padding.left - padding.right);
    };
    
    const yScale = (xp) => {
        return height - padding.bottom - (xp / maxXP) * (height - padding.top - padding.bottom);
    };
    
    // Create axes with updated padding
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
    
    // Add axis labels with better positioning
    createSvgElement('text', {
        x: width / 2,
        y: height - 15,
        'text-anchor': 'middle',
        textContent: 'Time'
    }, svg);
    
    // Position "Total XP" with plenty of space
    createSvgElement('text', {
        x: 20,  // Fixed position instead of formula
        y: height / 2,
        transform: `rotate(-90, 20, ${height/2})`,
        'text-anchor': 'middle',
        'font-size': '12px',  // Slightly smaller
        textContent: 'Total XP'
    }, svg);
    
    // X-axis (time)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dateRange = maxDate - minDate;
    const dayRange = dateRange / (1000 * 60 * 60 * 24);
    
    // Choose appropriate time intervals with fewer labels to prevent overlap
    let timePoints = [];
    if (dayRange <= 30) {
        // For short periods (≤30 days), show ~5 evenly spaced points
        const step = Math.max(1, Math.ceil(dayRange / 5));
        for (let i = 0; i <= dayRange; i += step) {
            const date = new Date(minDate.getTime() + i * 24 * 60 * 60 * 1000);
            timePoints.push(date);
        }
    } else {
        // For longer periods, show one label per quarter or every few months
        let currentDate = new Date(minDate);
        const monthStep = dayRange > 180 ? 3 : 2; // Quarterly or bi-monthly
        
        while (currentDate <= maxDate) {
            timePoints.push(new Date(currentDate));
            // Add months in steps to avoid overcrowding
            currentDate.setMonth(currentDate.getMonth() + monthStep);
        }
    }
    
    timePoints.forEach(date => {
        const x = xScale(date);
        
        // Tick mark
        createSvgElement('line', {
            x1: x,
            y1: height - padding.bottom,
            x2: x,
            y2: height - padding.bottom + 5,
            stroke: '#333'
        }, svg);
        
        // Label
        createSvgElement('text', {
            x: x,
            y: height - padding.bottom + 20,
            'text-anchor': 'middle',
            'font-size': '12px',
            textContent: dayRange <= 30 
                ? `${date.getDate()}/${date.getMonth() + 1}` 
                : `${monthNames[date.getMonth()]} ${date.getFullYear()}`
        }, svg);
    });
    
    // Y-axis (XP) with formatted values
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
        const xpValue = (maxXP / yTicks) * i;
        const y = yScale(xpValue);
        
        // Tick mark
        createSvgElement('line', {
            x1: padding.left,
            y1: y,
            x2: padding.left - 5,
            y2: y,
            stroke: '#333'
        }, svg);
        
        // Label with kB format
        createSvgElement('text', {
            x: padding.left - 15,  // More space from the axis
            y: y + 4,
            'text-anchor': 'end',
            'font-size': '12px',
            textContent: formatXpLabel(xpValue)
        }, svg);
        
        // Grid line
        createSvgElement('line', {
            x1: padding.left,
            y1: y,
            x2: width - padding.right,
            y2: y,
            stroke: '#ddd',
            'stroke-dasharray': '4,4'
        }, svg);
    }
    
    // Create line path
    let pathData = '';
    dataPoints.forEach((point, i) => {
        const x = xScale(point.date);
        const y = yScale(point.xp);
        pathData += (i === 0) ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });
    
    // Area fill under the line
    createSvgElement('path', {
        d: `${pathData} L ${xScale(maxDate)} ${height - padding.bottom} L ${xScale(minDate)} ${height - padding.bottom} Z`,
        fill: 'rgba(52, 152, 219, 0.2)'
    }, svg);
    
    // Line path
    createSvgElement('path', {
        d: pathData,
        fill: 'none',
        stroke: '#3498db',
        'stroke-width': '3'
    }, svg);
    
    // Add data points
    dataPoints.forEach(point => {
        const x = xScale(point.date);
        const y = yScale(point.xp);
        
        const circle = createSvgElement('circle', {
            cx: x,
            cy: y,
            r: '4',
            fill: '#3498db',
            stroke: '#fff',
            'stroke-width': '2',
            'data-xp': point.xp,
            'data-date': point.date.toLocaleDateString()
        }, svg);
        
        // Add hover effects
        circle.addEventListener('mouseover', function() {
            this.setAttribute('r', '6');
            
            // Create tooltip
            const tooltip = createSvgElement('g', { id: 'tooltip' }, svg);
            
            createSvgElement('rect', {
                x: x + 10,
                y: y - 30,
                width: '140',
                height: '45',
                rx: '5',
                fill: 'rgba(0,0,0,0.7)'
            }, tooltip);
            
            createSvgElement('text', {
                x: x + 20,
                y: y - 12,
                fill: 'white',
                'font-size': '12px',
                textContent: `XP: ${formatXpLabel(point.xp)}`
            }, tooltip);
            
            createSvgElement('text', {
                x: x + 20,
                y: y + 5,
                fill: 'white',
                'font-size': '12px',
                textContent: point.date.toLocaleDateString()
            }, tooltip);
        });
        
        circle.addEventListener('mouseout', function() {
            this.setAttribute('r', '4');
            const tooltip = document.getElementById('tooltip');
            if (tooltip) {
                svg.removeChild(tooltip);
            }
        });
    });
}

// SVG Graph 2: Project Pass/Fail Distribution
function createProjectRatioGraph(passed, failed) {
    const total = passed + failed;
    
    // Initialize SVG WITHOUT title (since it's already in HTML)
    const setup = setupSvgGraph(
        'project-ratio-graph',
        '',  // Empty string to skip title
        total > 0 ? { passed, failed } : null,
        'No project data available'
    );
    
    if (!setup) return;
    
    const { svg, width, height } = setup;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 40;
    
    // Calculate angles for pie chart
    const passedPercent = passed / total;
    const failedPercent = failed / total;
    const passedAngle = passedPercent * 360;
    
    // Colors
    const passedColor = '#2ecc71';
    const failedColor = '#e74c3c';
    
    // Create donut chart
    const donutWidth = radius * 0.4;
    
    // Inner circle
    createSvgElement('circle', {
        cx: centerX,
        cy: centerY,
        r: radius - donutWidth,
        fill: '#f5f5f5'
    }, svg);
    
    // Function to calculate SVG arc path
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
    
    // Passed segment
    if (passed > 0) {
        createSvgElement('path', {
            d: getArcPath(0, passedAngle, passedAngle > 180 ? 1 : 0),
            fill: passedColor
        }, svg);
    }
    
    // Failed segment
    if (failed > 0) {
        createSvgElement('path', {
            d: getArcPath(passedAngle, 360, (360 - passedAngle) > 180 ? 1 : 0),
            fill: failedColor
        }, svg);
    }
    
    // Calculate label positions
    const passedLabelAngle = (passedAngle / 2) - 90;
    const passedLabelRad = passedLabelAngle * Math.PI / 180;
    const passedLabelX = centerX + (radius - donutWidth/2) * Math.cos(passedLabelRad);
    const passedLabelY = centerY + (radius - donutWidth/2) * Math.sin(passedLabelRad);
    
    const failedLabelAngle = (passedAngle + (360 - passedAngle) / 2) - 90;
    const failedLabelRad = failedLabelAngle * Math.PI / 180;
    const failedLabelX = centerX + (radius - donutWidth/2) * Math.cos(failedLabelRad);
    const failedLabelY = centerY + (radius - donutWidth/2) * Math.sin(failedLabelRad);
    
    // Add data labels directly on segments
    if (passedPercent > 0.05) {  // Lower threshold to make label more likely to appear
        createSvgElement('text', {
            x: passedLabelX,
            y: passedLabelY,
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            'font-size': '14px',
            'font-weight': 'bold',
            'fill': 'black',  // Changed from white to black
            textContent: `${Math.round(passedPercent * 100)}% pass`  // Added "pass"
        }, svg);
    }
    
    // For larger segments (>20%), place label inside
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
    // For smaller segments (<20%), place label outside with connector
    else if (failedPercent > 0) {
        // Calculate position outside the segment
        const outsideLabelAngle = failedLabelAngle;
        const outsideLabelRad = outsideLabelAngle * Math.PI / 180;
        const outsideLabelX = centerX + (radius + 25) * Math.cos(outsideLabelRad);
        const outsideLabelY = centerY + (radius + 25) * Math.sin(outsideLabelRad);
        
        // Add connector line
        createSvgElement('line', {
            x1: centerX + radius * Math.cos(outsideLabelRad) * 0.8,
            y1: centerY + radius * Math.sin(outsideLabelRad) * 0.8,
            x2: outsideLabelX - 5 * Math.cos(outsideLabelRad),
            y2: outsideLabelY - 5 * Math.sin(outsideLabelRad),
            stroke: '#777',
            'stroke-width': '1'
        }, svg);
        
        // Add outside label
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
